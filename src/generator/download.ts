import { buildDocx } from "./buildDocx";
import { publicationShortLabel } from "./format";
import type { SopSpec } from "../model/sopSpec";

function safePart(value: string): string {
  return value
    .trim()
    .replace(/[\s/\\:]+/g, "-")
    .replace(/[^A-Za-z0-9._-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function filenameForSpec(spec: SopSpec): string {
  const kind = publicationShortLabel(spec.documentType);
  const number = safePart(spec.publicationNumber) || "NUMBER";
  const subject = safePart(spec.subject) || "Untitled";
  return `GLWCH-${kind}-${number}_${subject}.docx`;
}

export async function downloadDocx(spec: SopSpec): Promise<void> {
  const blob = await buildDocx(spec);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filenameForSpec(spec);
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
