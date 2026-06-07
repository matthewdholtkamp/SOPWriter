import { createDefaultSpec } from "../model/defaultSpec";
import type { DocumentType, SopSpec } from "../model/sopSpec";
import { extractLegacyOutline } from "./legacyOutline";
import { normalizeLegacyVerbiage } from "./normalizeVerbiage";

export type LegacyConversion = {
  spec: SopSpec;
  changes: string[];
  warnings: string[];
  questions: string[];
};

export function convertLegacyText(
  input: string,
  documentType: DocumentType = "regulation"
): LegacyConversion {
  const normalized = normalizeLegacyVerbiage(input);
  const outline = extractLegacyOutline(normalized.text, documentType);
  const identity = outline.identity;
  const spec = createDefaultSpec();

  spec.mode = "convert";
  spec.documentType = documentType;
  spec.publicationNumber = identity.number;
  spec.subject = identity.sourceTitle === "[Legacy Title]" ? "" : identity.sourceTitle;
  if (identity.legacyProponent) {
    spec.proponent = identity.legacyProponent;
    spec.sections.proponentAndWaivers = [
      {
        text: `The proponent of this publication is ${identity.legacyProponent}. Waiver requests will route through the hospital chain of command to the approval authority.`,
        children: []
      }
    ];
  }
  spec.references = outline.references.length ? outline.references : spec.references;
  spec.sections.purpose = outline.purpose;
  spec.sections.applicability = outline.applicability;
  spec.sections.canceledDocuments = [
    {
      text: `This GLWCH ${documentType === "regulation" ? "Regulation" : "Pamphlet"} cancels ${identity.sourceDesignation}, ${identity.sourceTitle}, ${identity.sourceDate}.`,
      children: []
    }
  ];
  spec.sections.responsibilitiesBrief = [
    { text: "Detailed responsibilities from the legacy publication are placed in Enclosure 2 for review.", children: [] }
  ];
  spec.sections.proceduresBrief = [
    { text: "Detailed procedures from the legacy publication are placed in Enclosure 3 for review.", children: [] }
  ];
  spec.enclosures.responsibilities = outline.responsibilities.length
    ? outline.responsibilities
    : [{ text: "Review and enter the responsibilities from the legacy publication.", children: [] }];
  spec.enclosures.procedures = outline.procedures.length
    ? outline.procedures
    : [{ text: "Review and enter the procedures from the legacy publication.", children: [] }];
  spec.legacy = {
    sourceDesignation: identity.sourceDesignation,
    sourceTitle: identity.sourceTitle,
    sourceDate: identity.sourceDate,
    ingestedText: normalized.text
  };
  spec.readiness.formattingConverted = true;
  spec.readiness.hospitalNameUpdated = !/General Leonard Wood Army Community Hospital/.test(normalized.text);
  spec.readiness.acronymUpdated = !/\bGLWACH\b/.test(normalized.text);

  const questions = [
    "Confirm the proponent department/directorate.",
    "Confirm the higher-level policy implemented by this publication.",
    "Confirm releasability: public release or not public."
  ];

  return {
    spec,
    changes: normalized.changes,
    warnings: normalized.warnings,
    questions
  };
}
