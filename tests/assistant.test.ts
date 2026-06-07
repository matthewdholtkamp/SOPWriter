import { afterEach, describe, expect, it, vi } from "vitest";
import { applyAssistantPatch, appliedFieldsFromResponse, normalizePublicationNumber } from "../src/assistant/apply";
import { requestSopAssistant } from "../src/assistant/client";
import { runSopAssistant } from "../src/assistant/session";
import {
  ASSISTANT_FALLBACK_MODEL,
  ASSISTANT_MODEL,
  ASSISTANT_WORKER_URL,
  assistantResponseSchema
} from "../src/assistant/schema";
import { validateSop } from "../src/validation/validate";
import { createSyntheticSpec } from "./fixtures";

function geminiResponse(text: string): Response {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text }] } }]
    }),
    { headers: { "Content-Type": "application/json" } }
  );
}

describe("SOP assistant schemas", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

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

  it("normalizes assistant publication numbers before saving", () => {
    expect(normalizePublicationNumber("GLWCH REG 40-1")).toBe("40-1");
    expect(normalizePublicationNumber("GLWCH Regulation No. 40-[TBD]")).toBe("40-[TBD]");
    expect(normalizePublicationNumber("Pamphlet No. 40-7")).toBe("40-7");

    const next = applyAssistantPatch(createSyntheticSpec(), {
      publicationNumber: "GLWCH Regulation No. 40-1"
    });
    expect(next.publicationNumber).toBe("40-1");
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

  it("runs the shared assistant helper and returns an applied next spec", async () => {
    const payload = {
      assistantMessage: "I mapped the legacy policy.",
      action: "applyPatch",
      specPatch: {
        mode: "convert",
        subject: "AI Converted Blood Products",
        sections: {
          purpose: [{ text: "This publication maps the legacy blood policy.", children: [] }]
        }
      },
      changedFields: [{ field: "subject" }],
      warnings: ["Confirm the proponent."],
      questions: []
    };
    vi.stubGlobal("fetch", vi.fn(async () => geminiResponse(JSON.stringify(payload))));

    const { appliedFields, nextSpec, response } = await runSopAssistant({
      messages: [],
      spec: createSyntheticSpec({ subject: "Legacy Subject" }),
      userText: "Map this legacy policy.",
      validationItems: []
    });

    expect(response.action).toBe("applyPatch");
    expect(appliedFields).toEqual(["subject", "mode", "above-signature sections"]);
    expect(nextSpec?.mode).toBe("convert");
    expect(nextSpec?.subject).toBe("AI Converted Blood Products");
  });

  it("returns no next spec when Gemini asks for clarification without a patch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        geminiResponse(
          JSON.stringify({
            assistantMessage: "I need the source publication number before mapping.",
            action: "askClarifyingQuestion",
            specPatch: null,
            changedFields: [],
            warnings: ["No structured patch returned."],
            questions: ["What is the source publication number?"]
          })
        )
      )
    );

    const { appliedFields, nextSpec, response } = await runSopAssistant({
      messages: [],
      spec: createSyntheticSpec(),
      userText: "Map this legacy policy.",
      validationItems: []
    });

    expect(nextSpec).toBeNull();
    expect(appliedFields).toEqual([]);
    expect(response.questions).toEqual(["What is the source publication number?"]);
  });

  it("shows both assistant-reported and actual patch fields", () => {
    const response = assistantResponseSchema.parse({
      assistantMessage: "Updated the SOP.",
      action: "applyPatch",
      specPatch: {
        publicationNumber: "40-1",
        subject: "Patient Identification",
        enclosures: { procedures: [{ text: "Verify identity.", children: [] }] }
      },
      changedFields: [{ field: "subject" }],
      warnings: [],
      questions: []
    });

    expect(appliedFieldsFromResponse(response)).toEqual([
      "subject",
      "publication number",
      "enclosures"
    ]);
  });

  it("calls the shared Worker in JSON mode without a Gemini responseSchema", async () => {
    const spec = createSyntheticSpec({
      legacy: {
        sourceDesignation: "MEDDAC Reg 40-43",
        sourceTitle: "Fall Prevention Program",
        sourceDate: "October 24, 2024",
        ingestedText: "Legacy text that should not be echoed in currentSop context."
      }
    });
    const payload = {
      assistantMessage: "I mapped the policy title.",
      action: "applyPatch",
      specPatch: { subject: "Fall Prevention Program" },
      changedFields: [{ field: "subject" }],
      warnings: [],
      questions: []
    };
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      geminiResponse(JSON.stringify(payload))
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await requestSopAssistant({
      userText: "Map this legacy MEDDAC policy.",
      messages: [],
      spec,
      validationItems: validateSop(spec).items
    });

    expect(response.specPatch?.subject).toBe("Fall Prevention Program");
    expect(fetchMock).toHaveBeenCalledWith(
      `${ASSISTANT_WORKER_URL}?stream=0`,
      expect.objectContaining({ method: "POST" })
    );
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init?.body as string);
    expect(body.model).toBe(ASSISTANT_MODEL);
    expect(body.fallbackModel).toBe(ASSISTANT_FALLBACK_MODEL);
    expect(body.stream).toBe(false);
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig).not.toHaveProperty("responseSchema");
    expect(body.systemInstruction.parts[0].text).toContain("publicationNumber");
    expect(body.systemInstruction.parts[0].text).toContain("National Performance Goals");
    expect(JSON.stringify(body)).not.toContain("GEMINI_API_KEY");
    expect(JSON.stringify(body)).not.toContain("Legacy text that should not be echoed");
  });

  it("recovers a full assistant response nested inside assistantMessage", async () => {
    const nested = {
      assistantMessage: "I recovered and updated SOP fields.",
      action: "applyPatch",
      specPatch: {
        subject: "Recovered Fall Prevention Program",
        sections: {
          responsibilitiesBrief: [
            { text: "Detailed responsibilities are in Enclosure 2.", children: [] }
          ]
        }
      },
      changedFields: [{ field: "subject" }, { field: "sections.responsibilitiesBrief" }],
      warnings: ["Review move-impacted locations."],
      questions: []
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        geminiResponse(
          JSON.stringify({
            assistantMessage: `\`\`\`json\n${JSON.stringify(nested, null, 2)}\n\`\`\``,
            action: "noChange",
            specPatch: null,
            changedFields: [],
            warnings: [],
            questions: []
          })
        )
      )
    );

    const response = await requestSopAssistant({
      userText: "Convert this pasted text.",
      messages: [],
      spec: createSyntheticSpec(),
      validationItems: []
    });

    expect(response.action).toBe("applyPatch");
    expect(response.assistantMessage).toBe("I recovered and updated SOP fields.");
    expect(response.specPatch?.subject).toBe("Recovered Fall Prevention Program");
    expect(response.changedFields.map(({ field }) => field)).toEqual([
      "subject",
      "sections.responsibilitiesBrief"
    ]);
  });

  it("keeps usable SOP fields when an optional AI field is malformed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        geminiResponse(
          JSON.stringify({
            assistantMessage: "I converted the policy.",
            action: "applyPatch",
            specPatch: {
              subject: "Fall Prevention Program",
              sections: {
                releasability: "notPublic",
                effectiveDate: "effective upon signature"
              }
            },
            changedFields: [{ field: "subject" }, { field: "sections.releasability" }],
            warnings: [],
            questions: []
          })
        )
      )
    );

    const response = await requestSopAssistant({
      userText: "Convert this pasted policy.",
      messages: [],
      spec: createSyntheticSpec(),
      validationItems: []
    });

    expect(response.specPatch?.subject).toBe("Fall Prevention Program");
    expect(response.specPatch?.sections?.releasability).toBe("notPublic");
    expect(response.specPatch?.sections).not.toHaveProperty("effectiveDate");
  });
});
