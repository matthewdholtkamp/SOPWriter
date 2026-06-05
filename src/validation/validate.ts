import { cloneSpec, type ParagraphNode, type SopSpec } from "../model/sopSpec";

export type ComplianceLevel = "pass" | "warn" | "fail";
export type SopStage = "identity" | "sections" | "enclosures" | "readiness" | "review";

export type ComplianceItem = {
  code: string;
  label: string;
  level: ComplianceLevel;
  detail: string;
  stage: SopStage;
  focusTarget?: string;
};

export type ValidationResult = {
  items: ComplianceItem[];
  blockingErrors: ComplianceItem[];
  warnings: ComplianceItem[];
  canGenerate: boolean;
};

const DATE_PATTERN =
  /^(?:\[DATE\]|(?:January|February|March|April|May|June|July|August|September|October|November|December) (?:[1-9]|[12]\d|3[01]), \d{4})$/;
const ACRONYM_PATTERN = /\b[A-Z][A-Z0-9-]{1,}\b/g;
const SUBJECT_ACRONYM_PATTERN = /\b[A-Z][A-Z0-9-]{1,}\b/;
const EXPANDED_ACRONYM_PATTERN = /\(([A-Z][A-Z0-9-]{1,})\)/g;
const SENTENCE_SPACING_PATTERN = /[.?] (?=\S)/;
const LOCATION_PATTERN =
  /\b(?:room|suite|floor|wing|building|located|location|hallway|corridor|entrance|exit|extension|pager|phone|clinic area)\b/i;
const MAX_DEPTH = 5;

const TARGETS: Record<string, { stage: SopStage; focusTarget?: string }> = {
  subject: { stage: "identity", focusTarget: "sop-subject" },
  "subject-acronym": { stage: "identity", focusTarget: "sop-subject" },
  references: { stage: "sections", focusTarget: "references-editor" },
  signature: { stage: "identity", focusTarget: "signature-editor" },
  date: { stage: "identity", focusTarget: "sop-date" },
  "required-sections": { stage: "sections", focusTarget: "sections-editor" },
  "required-enclosures": { stage: "enclosures", focusTarget: "enclosures-editor" },
  "lone-child": { stage: "sections", focusTarget: "sections-editor" },
  nesting: { stage: "sections", focusTarget: "sections-editor" },
  shall: { stage: "review", focusTarget: "compliance-panel" },
  acronym: { stage: "review", focusTarget: "compliance-panel" },
  "sentence-spacing": { stage: "review", focusTarget: "compliance-panel" },
  "legacy-verbiage": { stage: "readiness", focusTarget: "readiness-panel" },
  "move-review": { stage: "readiness", focusTarget: "readiness-panel" },
  "readiness-routing": { stage: "readiness", focusTarget: "readiness-panel" }
};

function item(code: string, label: string, level: ComplianceLevel, detail: string): ComplianceItem {
  return {
    code,
    label,
    level,
    detail,
    ...(TARGETS[code] ?? { stage: "review" as const })
  };
}

function isNodeEmpty(node: ParagraphNode): boolean {
  return !node.text.trim() && !node.heading?.trim() && node.children.every(isNodeEmpty);
}

function hasContent(nodes: ParagraphNode[] | null | undefined): boolean {
  return (nodes ?? []).some((node) => !isNodeEmpty(node));
}

function walk(nodes: ParagraphNode[], visit: (node: ParagraphNode, depth: number) => void, depth = 0): void {
  nodes.forEach((node) => {
    visit(node, depth);
    walk(node.children, visit, depth + 1);
  });
}

function allParagraphCollections(spec: SopSpec): ParagraphNode[][] {
  return [
    spec.sections.purpose,
    spec.sections.applicability,
    spec.sections.policyImplementation,
    spec.sections.canceledDocuments ?? [],
    spec.sections.responsibilitiesBrief,
    spec.sections.proceduresBrief,
    spec.sections.informationCollection ?? [],
    spec.sections.proponentAndWaivers,
    spec.sections.forms ?? [],
    spec.sections.summaryOfChanges ?? [],
    spec.enclosures.responsibilities,
    spec.enclosures.procedures,
    ...spec.enclosures.appendices.map((appendix) => appendix.body)
  ];
}

function allText(spec: SopSpec): string {
  const pieces = [
    spec.subject,
    spec.proponent,
    ...spec.references,
    spec.signature.name,
    spec.signature.rankBranch,
    ...spec.signature.title
  ];
  for (const collection of allParagraphCollections(spec)) {
    walk(collection, (node) => {
      pieces.push(node.heading ?? "", node.text);
    });
  }
  spec.glossary.acronyms.forEach((entry) => pieces.push(entry.term, entry.meaning));
  spec.glossary.definitions.forEach((entry) => pieces.push(entry.term, entry.definition));
  return pieces.join("\n");
}

function hasUnexpandedAcronym(text: string): boolean {
  const ignored = new Set(["DHA", "DoD", "OSD", "U.S.", "GLWCH"]);
  const expanded = new Set(
    [...text.matchAll(EXPANDED_ACRONYM_PATTERN)].map((match) => match[1])
  );
  return [...text.matchAll(ACRONYM_PATTERN)].some((match) => {
    const value = match[0];
    return !ignored.has(value) && !expanded.has(value);
  });
}

function hasLocationSensitiveProcedure(spec: SopSpec): boolean {
  return allParagraphCollections(spec).some((collection) => {
    let found = false;
    walk(collection, (node) => {
      if (LOCATION_PATTERN.test(`${node.heading ?? ""} ${node.text}`)) found = true;
    });
    return found;
  });
}

export function validateSop(spec: SopSpec): ValidationResult {
  const items: ComplianceItem[] = [];
  const text = allText(spec);
  let hasLoneChild = false;
  let hasDeepNesting = false;

  for (const collection of allParagraphCollections(spec)) {
    walk(collection, (node, depth) => {
      if (node.children.length === 1) hasLoneChild = true;
      if (depth > MAX_DEPTH) hasDeepNesting = true;
    });
  }

  items.push(
    spec.subject.trim()
      ? item("subject", "Subject", "pass", "A publication subject is present.")
      : item("subject", "Subject required", "fail", "Enter the publication subject.")
  );
  if (SUBJECT_ACRONYM_PATTERN.test(spec.subject)) {
    items.push(
      item("subject-acronym", "Subject acronym", "warn", "Avoid acronyms in the SUBJECT line.")
    );
  }
  items.push(
    DATE_PATTERN.test(spec.date.trim())
      ? spec.date.trim() === "[DATE]"
        ? item("date", "Date pending", "warn", "Complete the Month Day, Year date during signature workflow.")
        : item("date", "Date format", "pass", "Date uses Month Day, Year format.")
      : item("date", "Date format", "warn", "Use Month Day, Year, for example January 1, 2026.")
  );
  items.push(
    spec.references.some((reference) => reference.trim())
      ? item("references", "References", "pass", "Enclosure 1 has at least one reference.")
      : item("references", "References required", "fail", "Every publication needs Enclosure 1 references.")
  );

  const requiredSections = [
    ["Purpose", spec.sections.purpose],
    ["Applicability", spec.sections.applicability],
    ["Policy Implementation", spec.sections.policyImplementation],
    ["Responsibilities", spec.sections.responsibilitiesBrief],
    ["Procedures", spec.sections.proceduresBrief],
    ["Proponent and Waivers", spec.sections.proponentAndWaivers]
  ] as const;
  const missingSections = requiredSections
    .filter(([, nodes]) => !hasContent(nodes))
    .map(([label]) => label);
  items.push(
    missingSections.length
      ? item(
          "required-sections",
          "Required sections missing",
          "fail",
          `Complete: ${missingSections.join(", ")}.`
        )
      : item("required-sections", "Required sections", "pass", "All required above-signature sections have content.")
  );
  items.push(
    hasContent(spec.enclosures.responsibilities) && hasContent(spec.enclosures.procedures)
      ? item("required-enclosures", "Detailed enclosures", "pass", "Responsibilities and Procedures enclosures have content.")
      : item("required-enclosures", "Detailed enclosures required", "fail", "Complete Enclosure 2 Responsibilities and Enclosure 3 Procedures.")
  );
  items.push(
    spec.signature.name.trim() &&
      spec.signature.rankBranch.trim() &&
      spec.signature.title.some((title) => title.trim())
      ? item("signature", "Signature block", "pass", "Signature block is complete.")
      : item("signature", "Signature incomplete", "fail", "Enter signer name, rank/branch, title, and approval authority.")
  );
  items.push(
    hasLoneChild
      ? item("lone-child", "Lone subparagraph", "fail", "Each subordinate paragraph must have at least two siblings.")
      : item("lone-child", "Paragraph subdivisions", "pass", "No lone subparagraphs detected.")
  );
  if (hasDeepNesting) {
    items.push(item("nesting", "Paragraph nesting too deep", "fail", "Do not subordinate below DHA depth 5."));
  }
  if (/\bshall\b/i.test(text)) {
    items.push(item("shall", "Prohibited shall", "warn", 'Replace "shall" with must, will, may, or can based on meaning.'));
  }
  if (SENTENCE_SPACING_PATTERN.test(text)) {
    items.push(item("sentence-spacing", "Sentence spacing", "warn", "Use two spaces after sentence-ending periods and question marks."));
  }
  if (hasUnexpandedAcronym(text)) {
    items.push(item("acronym", "Acronym first use", "warn", "Confirm acronyms are expanded on first use and listed in the glossary when required."));
  }
  if (/GLWACH|General Leonard Wood Army Community Hospital/.test(text)) {
    items.push(item("legacy-verbiage", "Legacy hospital verbiage", "warn", "Residual GLWACH or old hospital-name text remains."));
  }
  const locationSensitive = hasLocationSensitiveProcedure(spec);
  items.push(
    locationSensitive && !spec.readiness.proceduresReviewedForMove
      ? item("move-review", "Move review needed", "warn", "Location, room, workflow, or phone language is present and must be reviewed for the new hospital.")
      : item("move-review", "Move review", "pass", "Move-sensitive procedure review is acknowledged or no obvious location terms were detected.")
  );
  items.push(
    spec.signature.approvalAuthority === "commander" && !spec.readiness.deputyLaneReviewed
      ? item("readiness-routing", "Deputy lane review", "warn", "Commander signature requires review through the corresponding Deputy lane before Executive Officer routing.")
      : item("readiness-routing", "Routing lane", "pass", "Routing readiness matches the selected approval authority.")
  );

  const blockingErrors = items.filter(({ level }) => level === "fail");
  const warnings = items.filter(({ level }) => level === "warn");
  return {
    items,
    blockingErrors,
    warnings,
    canGenerate: blockingErrors.length === 0
  };
}

export function fixSentenceSpacing(spec: SopSpec): SopSpec {
  const fixed = cloneSpec(spec);
  const replaceSpacing = (value: string) => value.replace(/([.?]) (?=\S)/g, "$1  ");
  const fixNodes = (nodes: ParagraphNode[]) => {
    nodes.forEach((node) => {
      node.text = replaceSpacing(node.text);
      if (node.heading) node.heading = replaceSpacing(node.heading);
      fixNodes(node.children);
    });
  };

  allParagraphCollections(fixed).forEach(fixNodes);
  fixed.references = fixed.references.map(replaceSpacing);
  return fixed;
}
