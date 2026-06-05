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
- Use only the bare local publication number in publicationNumber, such as "40-43", "40-[TBD]", or "[NUMBER]". Never include "GLWCH", "Reg", "Regulation", "Pam", "Pamphlet", or "No." in that field.
- Required above-signature order is Purpose, Applicability, Policy Implementation, Canceled Documents when applicable, Responsibilities, Procedures, Information Collection when applicable, Proponent and Waivers, Releasability, Effective Date, Forms when applicable, Summary of Changes when applicable.
- Paragraph text must not include manual labels such as "1.", "a.", or "(1)" because SOP Writer adds numbering automatically.
- Use must, will, may, or can. Never use shall.
- Use two spaces after sentence-ending periods and question marks.
- Spell dates as Month Day, Year, for example January 1, 2026.
- Assign responsibilities to officials, not offices.
- Convert General Leonard Wood Army Community Hospital to General Leonard Wood Community Hospital and GLWACH to GLWCH.
- When converting, place the legacy document into Canceled Documents and do not invent Policy Implementation, Proponent, or Releasability. Ask questions for missing facts.
- When authoring a new complete SOP from minimal input, replace generic defaults with a complete draft: all required above-signature sections, Enclosure 2 responsibilities, Enclosure 3 procedures, references, and glossary entries. Use [TBD] for local facts instead of inventing them.
- If the user did not provide the publication number, proponent, releasability decision, local system names, local forms, or local workflow owner, keep the existing placeholder or use [TBD]. Do not choose plausible local values such as "40-1" or "Department of Nursing" unless the user provided them.
- For new hospital patient-identification drafts, use current 2026 Joint Commission Hospital National Performance Goals language, including NPG #1, Right Patient, Right Care, and NPG.01.01.01. Do not call these National Patient Safety Goals in new 2026 drafts. Use older National Patient Safety Goals language only when mapping or quoting a legacy source.
- For new patient-identification drafts, include a references entry for "Joint Commission Hospital National Performance Goals, NPG #1, Right Patient, Right Care, NPG.01.01.01" unless the user says not to.
- For patient-identification drafts, include at least two patient identifiers, prohibit room number/bed/physical location as an identifier, cover medication and blood administration, procedures, noncommunicative or unknown patients, temporary identity, newborn identification, discrepancies, training, audits, and event reporting. Include explicit language that staff will label blood and specimen containers in the presence of the patient after identity verification. Mark local system names and local workflow details as [TBD].
- Flag, never rewrite, procedures depending on rooms, locations, phones, building layout, signage, or workflows because the hospital is moving.
- Never include PHI, patient details, real patient/staff examples, classified content, or private operational details not provided by the user.

JSON response shape:
{
  "assistantMessage": "Brief explanation for the user.",
  "action": "applyPatch" | "askClarifyingQuestion" | "noChange",
  "specPatch": {
    "mode": "author" | "convert",
    "documentType": "regulation" | "pamphlet",
    "publicationNumber": "string",
    "date": "Month Day, Year or [DATE]",
    "proponent": "string",
    "subject": "string",
    "references": ["string"],
    "sections": {
      "purpose": [{ "heading": "optional string", "text": "string", "children": [] }],
      "applicability": [{ "text": "string", "children": [] }],
      "policyImplementation": [{ "text": "string", "children": [] }],
      "canceledDocuments": [{ "text": "string", "children": [] }],
      "responsibilitiesBrief": [{ "text": "string", "children": [] }],
      "proceduresBrief": [{ "text": "string", "children": [] }],
      "proponentAndWaivers": [{ "text": "string", "children": [] }],
      "releasability": "public" | "notPublic",
      "effectiveDate": { "effectiveOnSignature": true, "expiresYears": 10 }
    },
    "enclosures": {
      "responsibilities": [{ "heading": "string", "text": "string", "children": [] }],
      "procedures": [{ "heading": "string", "text": "string", "children": [] }],
      "appendices": [{ "title": "string", "body": [{ "text": "string", "children": [] }] }]
    },
    "glossary": {
      "acronyms": [{ "term": "string", "meaning": "string" }],
      "definitions": [{ "term": "string", "definition": "string" }]
    },
    "readiness": {
      "formattingConverted": true,
      "hospitalNameUpdated": true,
      "acronymUpdated": true
    }
  },
  "changedFields": [{ "field": "sections.responsibilitiesBrief", "reason": "why changed" }],
  "warnings": ["short warning"],
  "questions": ["short question"]
}

Omit specPatch keys that should not change. Use "askClarifyingQuestion" when required facts are missing.`;

type JsonRecord = Record<string, any>;
type NormalizedAssistantResponse = {
  assistantMessage: string;
  action: "applyPatch" | "askClarifyingQuestion" | "noChange";
  specPatch: unknown | null;
  changedFields: Array<{ field: string; reason?: string }>;
  warnings: string[];
  questions: string[];
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

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function stringList(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string")
    ? value.map((entry) => entry.trim()).filter(Boolean)
    : null;
}

function booleanPatch(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function looksLikeJsonBlock(text: string): boolean {
  const trimmed = text.trim();
  return (
    /^```(?:json)?/i.test(trimmed) ||
    trimmed.startsWith("{") ||
    /"specPatch"|"assistantMessage"|"sections"|"enclosures"|"subject"/.test(trimmed)
  );
}

function patchChangedFields(patch: unknown): Array<{ field: string }> {
  const record = asRecord(patch);
  return record ? Object.keys(record).map((field) => ({ field })) : [];
}

function sanitizeParagraph(value: unknown, depth = 0): JsonRecord | null {
  if (typeof value === "string") {
    return value.trim() ? { text: value.trim(), children: [] } : null;
  }
  const record = asRecord(value);
  if (!record || typeof record.text !== "string") return null;
  const rawChildren = record.children === undefined ? [] : record.children;
  if (!Array.isArray(rawChildren)) return null;
  if (depth >= 5 && rawChildren.length > 0) return null;
  const children = rawChildren.map((child) => sanitizeParagraph(child, depth + 1));
  if (children.some((child) => !child)) return null;

  const paragraph: JsonRecord = {
    text: record.text.trim(),
    children
  };
  if (typeof record.heading === "string" && record.heading.trim()) {
    paragraph.heading = record.heading.trim();
  }
  return paragraph;
}

function sanitizeParagraphList(value: unknown): JsonRecord[] | null {
  if (!Array.isArray(value)) return null;
  const paragraphs = value.map((entry) => sanitizeParagraph(entry));
  if (paragraphs.some((paragraph) => !paragraph)) return null;
  return paragraphs as JsonRecord[];
}

function sanitizeSections(value: unknown): JsonRecord | null {
  const record = asRecord(value);
  if (!record) return null;

  const patch: JsonRecord = {};
  const paragraphFields = [
    "purpose",
    "applicability",
    "policyImplementation",
    "responsibilitiesBrief",
    "proceduresBrief",
    "proponentAndWaivers"
  ];
  const nullableParagraphFields = [
    "canceledDocuments",
    "informationCollection",
    "forms",
    "summaryOfChanges"
  ];

  for (const field of paragraphFields) {
    const paragraphs = sanitizeParagraphList(record[field]);
    if (paragraphs) patch[field] = paragraphs;
  }
  for (const field of nullableParagraphFields) {
    if (record[field] === null) {
      patch[field] = null;
    } else {
      const paragraphs = sanitizeParagraphList(record[field]);
      if (paragraphs) patch[field] = paragraphs;
    }
  }
  if (record.releasability === "public" || record.releasability === "notPublic") {
    patch.releasability = record.releasability;
  }

  const effectiveDate = asRecord(record.effectiveDate);
  if (effectiveDate) {
    const nextEffectiveDate: JsonRecord = {};
    if (typeof effectiveDate.effectiveOnSignature === "boolean") {
      nextEffectiveDate.effectiveOnSignature = effectiveDate.effectiveOnSignature;
    }
    if (
      typeof effectiveDate.expiresYears === "number" &&
      Number.isInteger(effectiveDate.expiresYears) &&
      effectiveDate.expiresYears >= 1 &&
      effectiveDate.expiresYears <= 30
    ) {
      nextEffectiveDate.expiresYears = effectiveDate.expiresYears;
    }
    if (Object.keys(nextEffectiveDate).length > 0) patch.effectiveDate = nextEffectiveDate;
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

function sanitizeSignature(value: unknown): JsonRecord | null {
  const record = asRecord(value);
  if (!record) return null;
  const patch: JsonRecord = {};
  for (const field of ["name", "rankBranch"]) {
    if (typeof record[field] === "string") patch[field] = record[field].trim();
  }
  const title = stringList(record.title);
  if (title && title.length > 0) patch.title = title;
  if (record.approvalAuthority === "commander" || record.approvalAuthority === "deputy") {
    patch.approvalAuthority = record.approvalAuthority;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

function sanitizeEnclosures(value: unknown): JsonRecord | null {
  const record = asRecord(value);
  if (!record) return null;
  const patch: JsonRecord = {};
  for (const field of ["responsibilities", "procedures"]) {
    const paragraphs = sanitizeParagraphList(record[field]);
    if (paragraphs) patch[field] = paragraphs;
  }
  if (Array.isArray(record.appendices)) {
    const appendices = record.appendices
      .map((appendix) => {
        const appendixRecord = asRecord(appendix);
        const body = sanitizeParagraphList(appendixRecord?.body);
        return appendixRecord && typeof appendixRecord.title === "string" && body
          ? { title: appendixRecord.title.trim(), body }
          : null;
      })
      .filter(Boolean);
    if (appendices.length > 0) patch.appendices = appendices;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

function sanitizeGlossary(value: unknown): JsonRecord | null {
  const record = asRecord(value);
  if (!record) return null;
  const patch: JsonRecord = {};
  if (Array.isArray(record.acronyms)) {
    const acronyms = record.acronyms
      .map((entry) => {
        const entryRecord = asRecord(entry);
        return entryRecord &&
          typeof entryRecord.term === "string" &&
          typeof entryRecord.meaning === "string"
          ? { term: entryRecord.term.trim(), meaning: entryRecord.meaning.trim() }
          : null;
      })
      .filter(Boolean);
    if (acronyms.length > 0) patch.acronyms = acronyms;
  }
  if (Array.isArray(record.definitions)) {
    const definitions = record.definitions
      .map((entry) => {
        const entryRecord = asRecord(entry);
        return entryRecord &&
          typeof entryRecord.term === "string" &&
          typeof entryRecord.definition === "string"
          ? { term: entryRecord.term.trim(), definition: entryRecord.definition.trim() }
          : null;
      })
      .filter(Boolean);
    if (definitions.length > 0) patch.definitions = definitions;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

function sanitizeLegacy(value: unknown): JsonRecord | null {
  const record = asRecord(value);
  if (!record) return null;
  const required = ["sourceDesignation", "sourceTitle", "sourceDate", "ingestedText"];
  if (!required.every((field) => typeof record[field] === "string")) return null;
  return {
    sourceDesignation: record.sourceDesignation.trim(),
    sourceTitle: record.sourceTitle.trim(),
    sourceDate: record.sourceDate.trim(),
    ingestedText: record.ingestedText
  };
}

function sanitizeReadiness(value: unknown): JsonRecord | null {
  const record = asRecord(value);
  if (!record) return null;
  const patch: JsonRecord = {};
  for (const field of [
    "formattingConverted",
    "hospitalNameUpdated",
    "acronymUpdated",
    "proceduresReviewedForMove",
    "affectedAreasReviewed",
    "deputyLaneReviewed"
  ]) {
    const value = booleanPatch(record[field]);
    if (value !== undefined) patch[field] = value;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

function sanitizePatch(value: unknown): JsonRecord | null {
  const record = asRecord(value);
  if (!record) return null;

  const patch: JsonRecord = {};
  if (record.mode === "author" || record.mode === "convert") patch.mode = record.mode;
  if (record.documentType === "regulation" || record.documentType === "pamphlet") {
    patch.documentType = record.documentType;
  }
  for (const field of ["publicationNumber", "date", "proponent", "subject"]) {
    if (typeof record[field] === "string") patch[field] = record[field].trim();
  }
  const references = stringList(record.references);
  if (references) patch.references = references;

  const sections = sanitizeSections(record.sections);
  if (sections) patch.sections = sections;
  const signature = sanitizeSignature(record.signature);
  if (signature) patch.signature = signature;
  const enclosures = sanitizeEnclosures(record.enclosures);
  if (enclosures) patch.enclosures = enclosures;
  const glossary = sanitizeGlossary(record.glossary);
  if (glossary) patch.glossary = glossary;
  if (record.legacy === null) {
    patch.legacy = null;
  } else {
    const legacy = sanitizeLegacy(record.legacy);
    if (legacy) patch.legacy = legacy;
  }
  const readiness = sanitizeReadiness(record.readiness);
  if (readiness) patch.readiness = readiness;

  return Object.keys(patch).length > 0 ? patch : null;
}

function sanitizeChangedFields(value: unknown, fallbackPatch: unknown): Array<{ field: string; reason?: string }> {
  if (!Array.isArray(value)) return patchChangedFields(fallbackPatch);
  return value
    .map((entry) => {
      const record = asRecord(entry);
      if (!record || typeof record.field !== "string") return null;
      return typeof record.reason === "string"
        ? { field: record.field, reason: record.reason }
        : { field: record.field };
    })
    .filter(Boolean) as Array<{ field: string; reason?: string }>;
}

function sanitizeAssistantResponse(value: unknown): NormalizedAssistantResponse | null {
  const record = asRecord(value);
  if (
    !record ||
    typeof record.assistantMessage !== "string" ||
    typeof record.action !== "string" ||
    !["applyPatch", "askClarifyingQuestion", "noChange"].includes(record.action)
  ) {
    return null;
  }

  const specPatch =
    record.specPatch === null || record.specPatch === undefined
      ? null
      : sanitizePatch(record.specPatch);
  if (record.action === "applyPatch" && !specPatch) return null;

  return {
    assistantMessage: record.assistantMessage,
    action: record.action as NormalizedAssistantResponse["action"],
    specPatch,
    changedFields: sanitizeChangedFields(record.changedFields, specPatch),
    warnings: stringList(record.warnings) ?? [],
    questions: stringList(record.questions) ?? []
  };
}

function normalizeAssistantResponse(value: unknown): unknown {
  const record = asRecord(value);
  if (!record) return value;

  const directResponse = sanitizeAssistantResponse(value);
  if (directResponse?.action === "applyPatch" && directResponse.specPatch) {
    return directResponse;
  }

  if (typeof record.assistantMessage !== "string") return value;
  if (!looksLikeJsonBlock(record.assistantMessage)) {
    if (record.action === "applyPatch") {
      throw new Error("The assistant said it updated the SOP, but did not return usable SOP fields. Please send again.");
    }
    return directResponse ?? value;
  }

  let nestedJson: unknown;
  try {
    nestedJson = extractJson(record.assistantMessage);
  } catch {
    throw new Error("The assistant returned SOP JSON in chat, but it was not valid enough to apply. Please send again.");
  }

  const nestedResponse = sanitizeAssistantResponse(nestedJson);
  if (nestedResponse) return nestedResponse;

  const nestedPatch = sanitizePatch(nestedJson);
  if (nestedPatch) {
    return {
      assistantMessage: "I updated the SOP fields from the assistant response.",
      action: "applyPatch",
      specPatch: nestedPatch,
      changedFields: patchChangedFields(nestedPatch),
      warnings: stringList(record.warnings) ?? [],
      questions: stringList(record.questions) ?? []
    };
  }

  throw new Error("The assistant returned SOP JSON in chat, but it did not match SOP Writer fields. Please send again.");
}

function contextForAssistant(
  userText: string,
  spec: SopSpec,
  validationItems: ComplianceItem[],
  messages: AssistantMessage[]
): string {
  const safeSpec: SopSpec = {
    ...spec,
    legacy: spec.legacy
      ? {
          ...spec.legacy,
          ingestedText: spec.legacy.ingestedText ? "[legacy text omitted from context]" : ""
        }
      : null
  };

  return JSON.stringify(
    {
      instruction: userText,
      currentSop: safeSpec,
      compliance: validationItems.map(({ code, label, level, detail }) => ({
        code,
        label,
        level,
        detail
      })),
      recentConversation: messages.slice(-8).map(({ role, text }) => ({ role, text }))
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
  const response = await fetch(`${ASSISTANT_WORKER_URL}?stream=0`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: ASSISTANT_MODEL,
      fallbackModel: ASSISTANT_FALLBACK_MODEL,
      stream: false,
      systemInstruction: { role: "system", parts: [{ text: SOP_ASSISTANT_PROMPT }] },
      contents: [
        {
          role: "user",
          parts: [
            {
              text: contextForAssistant(userText, spec, validationItems, messages)
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.35,
        responseMimeType: "application/json"
      }
    })
  });

  if (!response.ok) {
    const detail = (await response.text()).trim().slice(0, 300);
    throw new Error(
      detail
        ? `The Gemini Worker returned ${response.status}: ${detail}`
        : `The Gemini Worker returned ${response.status}.`
    );
  }

  const text = geminiText(await response.json());
  if (!text) {
    throw new Error("The assistant returned an empty response.");
  }

  return assistantResponseSchema.parse(normalizeAssistantResponse(extractJson(text)));
}
