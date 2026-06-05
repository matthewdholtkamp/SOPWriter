import { describe, expect, it } from "vitest";
import { buildDocx } from "../src/generator/buildDocx";
import { extractLegacyTextFromFile } from "../src/convert/ingest";
import { convertLegacyText } from "../src/convert/mapLegacy";
import { createSyntheticSpec } from "./fixtures";

describe("convertLegacyText", () => {
  it("maps legacy MEDDAC text into SOP structure and flags review items", () => {
    const result = convertLegacyText(`
MEDDAC Reg 40-43 Fall Prevention Program
24 OCT 2024

Purpose
This regulation establishes the GLWACH fall prevention process.

References
DHA-Procedural Instruction 5025.01, "Publication System," April 1, 2022

Applicability
This applies to General Leonard Wood Army Community Hospital.

Responsibilities
Nursing leadership shall review the program.

Procedures
Staff will report falls in Room 2-C.
`);

    expect(result.spec.mode).toBe("convert");
    expect(result.spec.publicationNumber).toBe("40-43");
    expect(result.spec.sections.canceledDocuments?.[0].text).toContain("MEDDAC Reg 40-43");
    expect(result.spec.enclosures.responsibilities[0].text).toContain("Nursing leadership");
    expect(result.spec.enclosures.procedures[0].text).toContain("Room 2-C");
    expect(result.changes.join(" ")).toContain("GLWACH to GLWCH");
    expect(result.warnings.join(" ")).toContain("shall");
    expect(result.warnings.join(" ")).toContain("move review");
    expect(result.questions.length).toBeGreaterThan(0);
  });

  it("uses split MEDDAC cover title lines instead of the functional area", () => {
    const result = convertLegacyText(`
MEDDAC Regulation 40-43
Medical Services
Fall Prevention
Program
Headquarters
USA MEDDAC
Fort Leonard Wood, Missouri
23 October 2024
UNCLASSIFIED

No. 40-43
Medical Services
FALL PREVENTION PROGRAM
1. Purpose. To establish an organization-wide policy.
2. References.
a. MEDCOM Reg 40-41, Patient Safety Program.
`);

    expect(result.spec.subject).toBe("Fall Prevention Program");
    expect(result.spec.sections.canceledDocuments?.[0].text).toContain(
      "Fall Prevention Program"
    );
  });

  it("preserves unlettered appendix references that begin with A or M", () => {
    const result = convertLegacyText(
      `
MEDDAC Pamphlet 40-7
Medical Services
Use of Blood and
Blood Products
Headquarters
USA MEDDAC
Fort Leonard Wood, Missouri
14 November 2024

APPENDIX A
References
AR 40-3 (Medical, Dental and Veterinary Care)
MEDDAC Reg 15-1 (Authorized Committees)
MEDDAC Pam 40-29 (Consent/Refusal of Medical Care)
`,
      "pamphlet"
    );

    expect(result.spec.subject).toBe("Use of Blood and Blood Products");
    expect(result.spec.references).toEqual([
      "AR 40-3 (Medical, Dental and Veterinary Care)",
      "MEDDAC Reg 15-1 (Authorized Committees)",
      "MEDDAC Pam 40-29 (Consent/Refusal of Medical Care)"
    ]);
  });

  it("extracts pasted-compatible text from plain text and Word files", async () => {
    const textFile = new File(["Purpose\r\nThis is legacy text."], "legacy.txt", {
      type: "text/plain"
    });
    await expect(extractLegacyTextFromFile(textFile)).resolves.toBe(
      "Purpose\nThis is legacy text."
    );

    const docxBlob = await buildDocx(createSyntheticSpec());
    const docxFile = new File([docxBlob], "legacy.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    });
    const docxText = await extractLegacyTextFromFile(docxFile);

    expect(docxText).toContain("Fall Prevention Program");
    expect(docxText).toContain("References:");
    expect(docxText).toContain("ENCLOSURE 1");
  });

  it("rejects unsupported file types with a paste fallback message", async () => {
    const file = new File(["{}"], "legacy.json", { type: "application/json" });
    await expect(extractLegacyTextFromFile(file)).rejects.toThrow(
      "Use a PDF, .docx, or .txt file, or paste the policy text."
    );
  });
});
