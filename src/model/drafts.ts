import { sopSpecSchema, type SopSpec } from "./sopSpec";

const ACTIVE_DRAFT_KEY = "sopwriter.activeDraft";

export function saveActiveDraft(spec: SopSpec): void {
  localStorage.setItem(ACTIVE_DRAFT_KEY, JSON.stringify(spec, null, 2));
}

export function restoreActiveDraft(): SopSpec | null {
  const raw = localStorage.getItem(ACTIVE_DRAFT_KEY);
  if (!raw) return null;
  try {
    return sopSpecSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function clearActiveDraft(): void {
  localStorage.removeItem(ACTIVE_DRAFT_KEY);
}

export function exportDraft(spec: SopSpec): string {
  return JSON.stringify(spec, null, 2);
}

export function importDraft(text: string): SopSpec {
  return sopSpecSchema.parse(JSON.parse(text));
}
