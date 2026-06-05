import { describe, expect, it } from "vitest";
import { applyAssistantPatch, appliedFieldsFromResponse } from "../src/assistant/apply";
import { assistantResponseSchema } from "../src/assistant/schema";
import { createSyntheticSpec } from "./fixtures";

describe("SOP assistant schemas", () => {
  it("applies validated SOP patches", () => {
    const spec = createSyntheticSpec();
    const next = applyAssistantPatch(spec, {
      subject: "Blood Products",
      sections: {
        releasability: "public",
        effectiveDate: { expiresYears: 5 }
      },
      glossary: {
        acronyms: [{ term: "MTF", meaning: "military medical treatment facility" }]
      }
    });
    expect(next.subject).toBe("Blood Products");
    expect(next.sections.releasability).toBe("public");
    expect(next.sections.effectiveDate.expiresYears).toBe(5);
    expect(next.glossary.acronyms[0].term).toBe("MTF");
  });

  it("parses response shape with specPatch", () => {
    const response = assistantResponseSchema.parse({
      assistantMessage: "Updated the SOP.",
      action: "applyPatch",
      specPatch: { subject: "Fall Prevention Program" },
      changedFields: [{ field: "subject" }],
      warnings: [],
      questions: []
    });
    expect(appliedFieldsFromResponse(response)).toEqual(["subject"]);
  });
});
