import type { SopSpec } from "../model/sopSpec";
import { buildTemplateDocx } from "./templateDocx";

export async function buildDocx(spec: SopSpec): Promise<Blob> {
  return buildTemplateDocx(spec);
}
