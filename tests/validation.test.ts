import { describe, expect, it } from "vitest";
import { fixSentenceSpacing, validateSop } from "../src/validation/validate";
import { createSyntheticSpec } from "./fixtures";

describe("validateSop", () => {
  it("blocks missing subject, references, required sections, enclosures, and signature", () => {
    const base = createSyntheticSpec();
    const spec = createSyntheticSpec({
      subject: "",
      references: [],
      sections: {
        ...base.sections,
        purpose: []
      },
      enclosures: {
        responsibilities: [],
        procedures: [],
        appendices: []
      },
      signature: { name: "", rankBranch: "", title: [""], approvalAuthority: "deputy" }
    });
    const result = validateSop(spec);
    expect(result.canGenerate).toBe(false);
    expect(result.blockingErrors.map((error) => error.code)).toEqual(
      expect.arrayContaining(["subject", "references", "required-sections", "required-enclosures", "signature"])
    );
  });

  it("warns for shall, date format, legacy verbiage, and move review", () => {
    const base = createSyntheticSpec();
    const spec = createSyntheticSpec({
      date: "1 June 2026",
      enclosures: {
        ...base.enclosures,
        procedures: [
          { text: "Staff shall report to Room 2-C in GLWACH.", children: [] },
          { text: "Staff will report to the alternate area.", children: [] }
        ]
      },
      readiness: {
        ...base.readiness,
        proceduresReviewedForMove: false
      }
    });
    const result = validateSop(spec);
    expect(result.canGenerate).toBe(true);
    expect(result.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining(["shall", "date", "legacy-verbiage", "move-review"])
    );
  });

  it("fixes one-space sentence spacing in paragraph text", () => {
    const base = createSyntheticSpec();
    const spec = createSyntheticSpec({
      sections: {
        ...base.sections,
        purpose: [{ text: "One sentence. Second sentence?", children: [] }]
      }
    });
    expect(fixSentenceSpacing(spec).sections.purpose[0].text).toBe("One sentence.  Second sentence?");
  });
});
