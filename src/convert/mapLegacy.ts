import { createDefaultSpec } from "../model/defaultSpec";
import type { DocumentType, ParagraphNode, SopSpec } from "../model/sopSpec";
import { normalizeLegacyVerbiage } from "./normalizeVerbiage";

export type LegacyConversion = {
  spec: SopSpec;
  changes: string[];
  warnings: string[];
  questions: string[];
};

type SectionMap = Record<string, string>;

const HEADING_ALIASES: Record<string, string> = {
  purpose: "purpose",
  references: "references",
  applicability: "applicability",
  responsibilities: "responsibilities",
  procedures: "procedures",
  procedure: "procedures",
  definitions: "definitions",
  glossary: "definitions",
  "acronyms": "definitions"
};

function cleanLine(line: string): string {
  return line
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b([a-z])/g, (match) => match.toUpperCase())
    .replace(/\bAnd\b/g, "and")
    .replace(/\bOf\b/g, "of")
    .replace(/\bThe\b/g, "the");
}

function detectLegacyIdentity(text: string, documentType: DocumentType) {
  const designationMatch = text.match(/\bMEDDAC\s+(Reg(?:ulation)?|Pam(?:phlet)?)\s+(\d+-\d+)\b/i);
  const sourceDesignation = designationMatch
    ? `MEDDAC ${/^pam/i.test(designationMatch[1]) ? "Pam" : "Reg"} ${designationMatch[2]}`
    : `MEDDAC ${documentType === "regulation" ? "Reg" : "Pam"} [NUMBER]`;
  const number = designationMatch?.[2] ?? "";
  const sourceDate =
    text.match(/\b(\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+\d{4})\b/i)?.[1] ??
    text.match(/\b([A-Z][a-z]+ \d{1,2}, \d{4})\b/)?.[1] ??
    "[DATE]";
  const subjectLine =
    text.match(/\bSUBJECT:\s*([^\n]+)/i)?.[1] ??
    text.match(/\b(?:Regulation|Pamphlet)\s+\d+-\d+\s+(.+)/i)?.[1] ??
    "";
  const sourceTitle = titleCase(
    cleanLine(subjectLine)
      .replace(/\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+\d{4}/i, "")
      .replace(/\bMEDDAC\b.*$/i, "")
  );
  return {
    sourceDesignation,
    sourceTitle: sourceTitle || "[Legacy Title]",
    sourceDate,
    number
  };
}

function splitSections(text: string): SectionMap {
  const sections: SectionMap = {};
  let current = "unmapped";
  sections[current] = "";

  for (const rawLine of text.split(/\r?\n/)) {
    const line = cleanLine(rawLine);
    if (!line) continue;
    const headingMatch = line.match(/^(?:\d+\.?\s+)?([A-Za-z][A-Za-z /&-]{2,40})(?:\.|:)?\s*$/);
    const alias = headingMatch ? HEADING_ALIASES[headingMatch[1].toLowerCase()] : undefined;
    if (alias) {
      current = alias;
      sections[current] = sections[current] ?? "";
      continue;
    }
    sections[current] = `${sections[current] ?? ""}${sections[current] ? "\n" : ""}${line}`;
  }

  return sections;
}

function paragraphNodesFromText(text: string, fallback: string): ParagraphNode[] {
  const lines = text
    .split(/\n+/)
    .map(cleanLine)
    .filter(Boolean);
  const source = lines.length ? lines : [fallback];
  return source.map((line) => ({
    text: line.replace(/^(?:\d+\.|[a-z]\.|\([a-z0-9]+\))\s*/i, ""),
    children: []
  }));
}

function referencesFromText(text: string): string[] {
  return text
    .split(/\n+/)
    .map(cleanLine)
    .filter(Boolean)
    .map((line) => line.replace(/^\(?[a-z]\)?\.?\s*/i, ""))
    .filter((line) => line.length > 6);
}

export function convertLegacyText(
  input: string,
  documentType: DocumentType = "regulation"
): LegacyConversion {
  const normalized = normalizeLegacyVerbiage(input);
  const identity = detectLegacyIdentity(normalized.text, documentType);
  const sections = splitSections(normalized.text);
  const spec = createDefaultSpec();

  spec.mode = "convert";
  spec.documentType = documentType;
  spec.publicationNumber = identity.number;
  spec.subject = identity.sourceTitle === "[Legacy Title]" ? "" : identity.sourceTitle;
  spec.references = referencesFromText(sections.references ?? "").length
    ? referencesFromText(sections.references ?? "")
    : spec.references;
  spec.sections.purpose = paragraphNodesFromText(
    sections.purpose ?? "",
    "This publication establishes local procedures for the converted legacy policy."
  );
  spec.sections.applicability = paragraphNodesFromText(
    sections.applicability ?? "",
    "This publication applies to General Leonard Wood Community Hospital, outlying clinics, and assigned or attached personnel."
  );
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
  spec.enclosures.responsibilities = paragraphNodesFromText(
    sections.responsibilities ?? "",
    "Review and enter the responsibilities from the legacy publication."
  );
  spec.enclosures.procedures = paragraphNodesFromText(
    sections.procedures ?? sections.unmapped ?? "",
    "Review and enter the procedures from the legacy publication."
  );
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
