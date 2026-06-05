import type { SopSpec } from "../model/sopSpec";
import type { ComplianceItem } from "../validation/validate";
import {
  ASSISTANT_FALLBACK_MODEL,
  ASSISTANT_MODEL,
  ASSISTANT_WORKER_URL,
  assistantResponseSchema,
  type AssistantMessage,
  type AssistantResponse
} from "./schema";

const SOP_ASSISTANT_PROMPT = `You are Dr. Holtkamp SOP Assist inside SOP Writer.

Mission:
- Help users convert rough notes or legacy MEDDAC Pam/Reg text into a GLWCH publication draft.
- Return only strict JSON matching the requested response shape. Do not use Markdown fences.
- The browser app validates and formats the document; you only propose field updates.

Rules:
- Output GLWCH Regulations or GLWCH Pamphlets in DHA publication format.
- Do not change specVersion or profileId.
- Required above-signature order is Purpose, Applicability, Policy Implementation, Canceled Documents when applicable, Responsibilities, Procedures, Information Collection when applicable, Proponent and Waivers, Releasability, Effective Date, Forms when applicable, Summary of Changes when applicable.
- Paragraph text must not include manual labels such as "1.", "a.", or "(1)" because SOP Writer adds numbering automatically.
- Use must, will, may, or can. Never use shall.
- Use two spaces after sentence-ending periods and question marks.
- Spell dates as Month Day, Year, for example January 1, 2026.
- Assign responsibilities to officials, not offices.
- Convert General Leonard Wood Army Community Hospital to General Leonard Wood Community Hospital and GLWACH to GLWCH.
- When converting, place the legacy document into Canceled Documents and do not invent Policy Implementation, Proponent, or Releasability. Ask questions for missing facts.
- Flag, never rewrite, procedures depending on rooms, locations, phones, building layout, signage, or workflows because the hospital is moving.
- Never include PHI, patient details, real patient/staff examples, classified content, or private operational details not provided by the user.

JSON response shape:
{
  "assistantMessage": "Brief explanation for the user.",
  "action": "applyPatch" | "askClarifyingQuestion" | "noChange",
  "specPatch": {},
  "changedFields": [{ "field": "sections.responsibilitiesBrief", "reason": "why changed" }],
  "warnings": ["short warning"],
  "questions": ["short question"]
}

Omit specPatch keys that should not change. Use "askClarifyingQuestion" when required facts are missing.`;

function paragraphResponseSchema(depth = 0): Record<string, unknown> {
  return {
    type: "OBJECT",
    properties: {
      heading: { type: "STRING" },
      text: { type: "STRING" },
      children: {
        type: "ARRAY",
        items:
          depth >= 5
            ? {
                type: "OBJECT",
                properties: {
                  text: { type: "STRING" },
                  children: { type: "ARRAY", items: { type: "OBJECT" } }
                },
                required: ["text", "children"]
              }
            : paragraphResponseSchema(depth + 1)
      }
    },
    required: ["text", "children"]
  };
}

const assistantGeminiResponseSchema = {
  type: "OBJECT",
  properties: {
    assistantMessage: { type: "STRING" },
    action: { type: "STRING", enum: ["applyPatch", "askClarifyingQuestion", "noChange"] },
    specPatch: {
      type: "OBJECT",
      properties: {
        mode: { type: "STRING", enum: ["author", "convert"] },
        documentType: { type: "STRING", enum: ["regulation", "pamphlet"] },
        publicationNumber: { type: "STRING" },
        date: { type: "STRING" },
        proponent: { type: "STRING" },
        subject: { type: "STRING" },
        references: { type: "ARRAY", items: { type: "STRING" } },
        sections: {
          type: "OBJECT",
          properties: {
            purpose: { type: "ARRAY", items: paragraphResponseSchema() },
            applicability: { type: "ARRAY", items: paragraphResponseSchema() },
            policyImplementation: { type: "ARRAY", items: paragraphResponseSchema() },
            canceledDocuments: { type: "ARRAY", items: paragraphResponseSchema() },
            responsibilitiesBrief: { type: "ARRAY", items: paragraphResponseSchema() },
            proceduresBrief: { type: "ARRAY", items: paragraphResponseSchema() },
            informationCollection: { type: "ARRAY", items: paragraphResponseSchema() },
            proponentAndWaivers: { type: "ARRAY", items: paragraphResponseSchema() },
            releasability: { type: "STRING", enum: ["public", "notPublic"] },
            forms: { type: "ARRAY", items: paragraphResponseSchema() },
            summaryOfChanges: { type: "ARRAY", items: paragraphResponseSchema() }
          }
        },
        enclosures: {
          type: "OBJECT",
          properties: {
            responsibilities: { type: "ARRAY", items: paragraphResponseSchema() },
            procedures: { type: "ARRAY", items: paragraphResponseSchema() }
          }
        },
        glossary: {
          type: "OBJECT",
          properties: {
            acronyms: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: { term: { type: "STRING" }, meaning: { type: "STRING" } },
                required: ["term", "meaning"]
              }
            },
            definitions: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: { term: { type: "STRING" }, definition: { type: "STRING" } },
                required: ["term", "definition"]
              }
            }
          }
        }
      }
    },
    changedFields: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          field: { type: "STRING" },
          reason: { type: "STRING" }
        },
        required: ["field"]
      }
    },
    warnings: { type: "ARRAY", items: { type: "STRING" } },
    questions: { type: "ARRAY", items: { type: "STRING" } }
  },
  required: ["assistantMessage", "action", "changedFields", "warnings", "questions"]
};

function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error("The assistant returned text instead of structured SOP JSON.");
  }
}

function geminiText(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const candidates = (data as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates)) return "";
  return candidates
    .flatMap((candidate) => {
      const parts = (candidate as { content?: { parts?: unknown } }).content?.parts;
      return Array.isArray(parts) ? parts : [];
    })
    .map((part) => (typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : ""))
    .join("")
    .trim();
}

function contextForAssistant(spec: SopSpec, validationItems: ComplianceItem[]): string {
  return JSON.stringify(
    {
      currentSpec: spec,
      compliance: validationItems.map(({ code, level, detail }) => ({ code, level, detail }))
    },
    null,
    2
  );
}

export async function requestSopAssistant({
  spec,
  messages,
  userText,
  validationItems
}: {
  spec: SopSpec;
  messages: AssistantMessage[];
  userText: string;
  validationItems: ComplianceItem[];
}): Promise<AssistantResponse> {
  const body = {
    model: ASSISTANT_MODEL,
    fallbackModel: ASSISTANT_FALLBACK_MODEL,
    stream: false,
    systemInstruction: { role: "system", parts: [{ text: SOP_ASSISTANT_PROMPT }] },
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `Current SOP context:\n${contextForAssistant(spec, validationItems)}`
          }
        ]
      },
      ...messages
        .filter((message) => message.role !== "system")
        .slice(-8)
        .map((message) => ({
          role: message.role === "assistant" ? "model" : "user",
          parts: [{ text: message.text }]
        })),
      {
        role: "user",
        parts: [{ text: userText }]
      }
    ],
    generationConfig: {
      temperature: 0.3,
      responseMimeType: "application/json",
      responseSchema: assistantGeminiResponseSchema
    }
  };

  const response = await fetch(`${ASSISTANT_WORKER_URL}?stream=0`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(`SOP Assist request failed with status ${response.status}.`);
  }
  const data = await response.json();
  const parsed = extractJson(geminiText(data));
  return assistantResponseSchema.parse(parsed);
}
