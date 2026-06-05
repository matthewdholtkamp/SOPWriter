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

  it("warns for patient-identification policy gaps", () => {
    const base = createSyntheticSpec();
    const spec = createSyntheticSpec({
      subject: "Patient Identification Before Care, Treatment, and Services",
      sections: {
        ...base.sections,
        purpose: [
          {
            text: "This regulation establishes patient identification requirements before care, treatment, and services.",
            children: []
          }
        ]
      },
      enclosures: {
        ...base.enclosures,
        procedures: [
          {
            text: "Identification may be deferred until the patient is stabilized.",
            children: []
          },
          {
            text: "Staff will verify the patient when practical.",
            children: []
          }
        ]
      }
    });

    const result = validateSop(spec);
    expect(result.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining([
        "patient-id-npg-reference",
        "patient-id-two-identifiers",
        "patient-id-location-identifier",
        "patient-id-specimen-labeling",
        "patient-id-emergency-deferral"
      ])
    );
  });

  it("accepts patient-identification essentials when present", () => {
    const base = createSyntheticSpec();
    const spec = createSyntheticSpec({
      subject: "Patient Identification Before Care, Treatment, and Services",
      references: [
        "Joint Commission Hospital National Performance Goals, NPG #1, Right Patient, Right Care, NPG.01.01.01"
      ],
      sections: {
        ...base.sections,
        purpose: [
          {
            text: "This regulation establishes patient identification requirements before care, treatment, and services.",
            children: []
          }
        ]
      },
      enclosures: {
        ...base.enclosures,
        procedures: [
          {
            text: "Staff will use at least two patient identifiers before providing care, treatment, or services.",
            children: []
        },
        {
          text: "The use of room numbers or physical locations for patient identification is strictly prohibited.",
          children: []
        },
          {
            text: "Staff will label blood and specimen containers in the presence of the patient after identity verification.",
            children: []
          }
        ]
      }
    });

    const codes = validateSop(spec).warnings.map((warning) => warning.code);
    expect(codes).not.toContain("patient-id-npg-reference");
    expect(codes).not.toContain("patient-id-two-identifiers");
    expect(codes).not.toContain("patient-id-location-identifier");
    expect(codes).not.toContain("patient-id-specimen-labeling");
    expect(codes).not.toContain("patient-id-emergency-deferral");
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
