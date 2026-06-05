import { cloneSpec, type SopSpec } from "../model/sopSpec";
import type { AssistantPatch, AssistantResponse } from "./schema";

const FIELD_LABELS: Record<string, string> = {
  documentType: "document type",
  publicationNumber: "publication number",
  date: "date",
  proponent: "proponent",
  subject: "subject",
  references: "references",
  sections: "above-signature sections",
  signature: "signature block",
  enclosures: "enclosures",
  glossary: "glossary",
  readiness: "readiness checks"
};

function normalizeStringList(values: string[]): string[] {
  return values.map((value) => value.trim()).filter(Boolean);
}

export function summarizePatchFields(patch: AssistantPatch): string[] {
  return Object.keys(patch).map((field) => FIELD_LABELS[field] ?? field);
}

export function applyAssistantPatch(baseSpec: SopSpec, patch: AssistantPatch): SopSpec {
  const next = cloneSpec(baseSpec);

  if (patch.mode !== undefined) next.mode = patch.mode;
  if (patch.documentType !== undefined) next.documentType = patch.documentType;
  if (patch.publicationNumber !== undefined) next.publicationNumber = patch.publicationNumber.trim();
  if (patch.date !== undefined) next.date = patch.date.trim();
  if (patch.proponent !== undefined) next.proponent = patch.proponent.trim();
  if (patch.subject !== undefined) next.subject = patch.subject.trim();
  if (patch.references !== undefined) next.references = normalizeStringList(patch.references);
  if (patch.sections !== undefined) {
    next.sections = {
      ...next.sections,
      ...patch.sections,
      effectiveDate: {
        ...next.sections.effectiveDate,
        ...(patch.sections.effectiveDate ?? {})
      }
    };
  }
  if (patch.signature !== undefined) {
    next.signature = {
      ...next.signature,
      ...patch.signature,
      name: patch.signature.name?.trim() ?? next.signature.name,
      rankBranch: patch.signature.rankBranch?.trim() ?? next.signature.rankBranch,
      title: patch.signature.title?.map((line) => line.trim()).filter(Boolean) ?? next.signature.title
    };
  }
  if (patch.enclosures !== undefined) {
    next.enclosures = {
      ...next.enclosures,
      ...patch.enclosures
    };
  }
  if (patch.glossary !== undefined) {
    next.glossary = {
      ...next.glossary,
      acronyms: patch.glossary.acronyms ?? next.glossary.acronyms,
      definitions: patch.glossary.definitions ?? next.glossary.definitions
    };
  }
  if (patch.legacy !== undefined) next.legacy = patch.legacy;
  if (patch.readiness !== undefined) {
    next.readiness = { ...next.readiness, ...patch.readiness };
  }

  return next;
}

export function appliedFieldsFromResponse(response: AssistantResponse): string[] {
  if (response.changedFields.length > 0) {
    return response.changedFields.map(({ field }) => field);
  }
  return response.specPatch ? summarizePatchFields(response.specPatch) : [];
}
