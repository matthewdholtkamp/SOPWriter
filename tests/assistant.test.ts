import { afterEach, describe, expect, it, vi } from "vitest";
import { applyAssistantPatch, appliedFieldsFromResponse } from "../src/assistant/apply";
import { requestSopAssistant } from "../src/assistant/client";
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
