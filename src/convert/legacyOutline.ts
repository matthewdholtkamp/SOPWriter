import type { DocumentType, ParagraphNode } from "../model/sopSpec";

export type LegacyOutlineNode = {
  marker?: string;
  title?: string;
  text: string;
  children: LegacyOutlineNode[];
};

export type LegacyOutline = {
  identity: {
    legacyProponent?: string;
    number: string;
    sourceDate: string;
    sourceDesignation: string;
    sourceTitle: string;
  };
  lines: string[];
  sections: LegacyOutlineNode[];
  references: string[];
  responsibilities: ParagraphNode[];
  procedures: ParagraphNode[];
  purpose: ParagraphNode[];
  applicability: ParagraphNode[];
};

function cleanLine(line: string): string {
  return line
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
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

function isCoverOrPageNoise(line: string): boolean {
  return (
    /^(?:UNCLASSIFIED|DEPARTMENT OF THE ARMY|Headquarters|USA MEDDAC|Fort Leonard Wood, Missouri|Medical Services)$/i.test(line) ||
    /^MEDDAC\s+(?:Reg|Pam)\s+\d+-\d+\s*[•-]\s*\d{1,2}\s+[A-Z][a-z]+\s+\d{4}$/i.test(line) ||
    /^\d+$/.test(line)
  );
}

function cleanLegacyLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map(cleanLine)
    .filter(Boolean)
    .filter((line) => !isCoverOrPageNoise(line));
}

function administrativeTailIndex(lines: string[]): number {
  const index = lines.findIndex((line) =>
    /^(?:The proponent of this publication is\b|FOR THE COMMANDER:?$|DISTRIBUTION:?$|Digitally signed by\b)/i.test(line)
  );
  return index >= 0 ? index : lines.length;
}

function detectLegacyProponent(lines: string[]): string | undefined {
  const index = lines.findIndex((line) => /^The proponent of this publication is\b/i.test(line));
  if (index < 0) return undefined;

  const paragraph: string[] = [];
  for (const line of lines.slice(index)) {
    if (paragraph.length && /^(?:FOR THE COMMANDER:?$|DISTRIBUTION:?$|Digitally signed by\b)/i.test(line)) break;
    paragraph.push(line);
  }

  const text = paragraph.join(" ");
  const match = text.match(/^The proponent of this publication is\s+(.+?)(?:\.| Users are invited|$)/i);
  return match?.[1]?.trim().replace(/\.$/, "") || undefined;
}

function detectCoverTitle(lines: string[], number: string): string {
  const designationIndex = lines.findIndex((line) =>
    /\bMEDDAC\s+(?:Reg(?:ulation)?|Pam(?:phlet)?)\s+\d+-\d+\b/i.test(line)
  );
  const titleLines: string[] = [];
  if (designationIndex >= 0) {
    for (const line of lines.slice(designationIndex + 1, designationIndex + 8)) {
      if (
        /^(?:Headquarters|USA MEDDAC|Fort Leonard Wood|UNCLASSIFIED|DEPARTMENT OF THE ARMY|General Leonard Wood|No\.|MEDDAC\s+(?:Reg|Pam)\b|\d+$)/i.test(line) ||
        /^\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC|January|February|March|April|May|June|July|August|September|October|November|December)/i.test(line)
      ) {
        break;
      }
      if (/^Medical Services$/i.test(line)) continue;
      titleLines.push(line);
    }
  }
  if (titleLines.length) return titleCase(titleLines.join(" "));

  const numberIndex = number
    ? lines.findIndex((line) => new RegExp(`^No\\.\\s*${number}\\b`, "i").test(line))
    : -1;
  if (numberIndex >= 0) {
    for (const line of lines.slice(numberIndex + 1, numberIndex + 6)) {
      if (/^\d+(?:-\d+)?\.?\s+/.test(line) || /^Medical Services$/i.test(line)) continue;
      titleLines.push(line);
      if (titleLines.join(" ").length > 8) break;
    }
  }
  return titleLines.length ? titleCase(titleLines.join(" ")) : "[Legacy Title]";
}

function detectIdentity(text: string, lines: string[], documentType: DocumentType): LegacyOutline["identity"] {
  const designationMatch = text.match(/\bMEDDAC\s+(Reg(?:ulation)?|Pam(?:phlet)?)\s+(\d+-\d+)\b/i);
  const number = designationMatch?.[2] ?? "";
  const sourceDesignation = designationMatch
    ? `MEDDAC ${/^pam/i.test(designationMatch[1]) ? "Pam" : "Reg"} ${designationMatch[2]}`
    : `MEDDAC ${documentType === "regulation" ? "Reg" : "Pam"} [NUMBER]`;
  const sourceDate =
    text.match(/\b(\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+\d{4})\b/i)?.[1] ??
    text.match(/\b([A-Z][a-z]+ \d{1,2}, \d{4})\b/)?.[1] ??
    "[DATE]";
  const sourceTitle = detectCoverTitle(lines, number);
  return { number, sourceDate, sourceDesignation, sourceTitle };
}

function markerLevel(marker: string): number {
  if (/^\d+$/.test(marker)) return 0;
  if (/^[a-z]$/.test(marker)) return 1;
  if (/^\(\d+\)$/.test(marker)) return 2;
  if (/^\([a-z]\)$/.test(marker)) return 3;
  return 4;
}

function splitHeadingAndText(value: string, marker: string): { title?: string; text: string } {
  const text = value.trim();
  if (!text) return { text: "" };

  const firstSentence = text.match(/^(.{2,95}?)\.\s+(.*)$/);
  if (firstSentence) {
    return { title: firstSentence[1].trim(), text: firstSentence[2].trim() };
  }
  if (/^\d+$/.test(marker)) {
    return { title: text.replace(/\.$/, ""), text: "" };
  }
  return { text };
}

function parseMarkedLine(line: string): { marker: string; rest: string } | null {
  const match =
    line.match(/^(\d{1,2})\.\s+(.+)$/) ??
    line.match(/^([a-z])\.\s+(.+)$/) ??
    line.match(/^(\(\d+\))\s+(.+)$/) ??
    line.match(/^(\([a-z]\))\s+(.+)$/);
  return match ? { marker: match[1], rest: match[2] } : null;
}

function appendText(node: LegacyOutlineNode, text: string): void {
  node.text = `${node.text}${node.text ? " " : ""}${text}`.trim();
}

function appendUnmarkedLine(node: LegacyOutlineNode, text: string): void {
  if (
    node.marker &&
    /^\d+$/.test(node.marker) &&
    node.title &&
    !node.text &&
    !node.children.length &&
    text.length < 120 &&
    /^[A-Z]/.test(text)
  ) {
    node.title = `${node.title} ${text.replace(/\.$/, "")}`.trim();
    return;
  }
  appendText(node, text);
}

function parseOutlineNodes(lines: string[]): LegacyOutlineNode[] {
  const roots: LegacyOutlineNode[] = [];
  const stack: Array<{ level: number; node: LegacyOutlineNode }> = [];

  for (const line of lines) {
    const marked = parseMarkedLine(line);
    if (!marked) {
      const current = stack.at(-1)?.node;
      if (current) appendUnmarkedLine(current, line);
      continue;
    }

    const level = markerLevel(marked.marker);
    const { title, text } = splitHeadingAndText(marked.rest, marked.marker);
    const node: LegacyOutlineNode = {
      marker: marked.marker,
      title,
      text,
      children: []
    };

    while (stack.length && stack.at(-1)!.level >= level) stack.pop();
    const parent = stack.at(-1)?.node;
    if (parent) parent.children.push(node);
    else roots.push(node);
    stack.push({ level, node });
  }

  return roots;
}

function paragraphFromNode(node: LegacyOutlineNode): ParagraphNode {
  return {
    heading: node.title,
    text: node.text,
    children: node.children.map(paragraphFromNode)
  };
}

function sectionBodyParagraph(node: LegacyOutlineNode): ParagraphNode {
  return {
    text: node.text || node.title || "",
    children: node.children.map(paragraphFromNode)
  };
}

function plainParagraph(text: string): ParagraphNode {
  return { text, children: [] };
}

function nodeTitle(node: LegacyOutlineNode): string {
  return `${node.title ?? ""} ${node.text}`.trim();
}

function findTopSection(sections: LegacyOutlineNode[], matcher: RegExp): LegacyOutlineNode | undefined {
  return sections.find((section) => matcher.test(nodeTitle(section)));
}

function collectReferenceText(node: LegacyOutlineNode): string[] {
  if (!node.children.length) return node.text ? [node.text] : [];
  return node.children
    .map((child) => `${child.title ?? ""}${child.title && child.text ? ", " : ""}${child.text}`.trim())
    .filter((entry) => entry.length > 5)
    .map((entry) => entry.replace(/\.$/, ""));
}

function looseHeadingKey(line: string): string | null {
  const normalized = line.toLowerCase().replace(/:$/, "");
  if (["purpose", "references", "applicability", "responsibilities", "procedures", "procedure"].includes(normalized)) {
    return normalized === "procedure" ? "procedures" : normalized;
  }
  return null;
}

function splitLooseSections(lines: string[]): Record<string, string[]> {
  const sections: Record<string, string[]> = {};
  let current = "unmapped";
  sections[current] = [];
  for (const line of lines) {
    const key = looseHeadingKey(line);
    if (key) {
      current = key;
      sections[current] = sections[current] ?? [];
    } else {
      sections[current].push(line);
    }
  }
  return sections;
}

function looseParagraphs(lines: string[], fallback: string): ParagraphNode[] {
  const source = lines.length ? lines : [fallback];
  return source
    .map((line) => line.trim())
    .filter(Boolean)
    .map((text) => ({ text, children: [] }));
}

export function extractLegacyOutline(input: string, documentType: DocumentType = "regulation"): LegacyOutline {
  const cleanedLines = cleanLegacyLines(input);
  const legacyProponent = detectLegacyProponent(cleanedLines);
  const lines = cleanedLines.slice(0, administrativeTailIndex(cleanedLines));
  const identity = { ...detectIdentity(input, lines, documentType), legacyProponent };
  const bodyStart = lines.findIndex((line) => /^1\.\s+Purpose\b/i.test(line));
  const bodyLines = bodyStart >= 0 ? lines.slice(bodyStart) : lines;
  const sections = parseOutlineNodes(bodyLines);
  if (!sections.length) {
    const loose = splitLooseSections(lines);
    return {
      identity,
      lines,
      sections: [],
      references: (loose.references ?? []).map((line) => line.replace(/^(?:\([a-z]\)|[a-z]\.)\s+/i, "")),
      responsibilities: looseParagraphs(
        loose.responsibilities ?? [],
        "Review and enter the responsibilities from the legacy publication."
      ),
      procedures: looseParagraphs(
        loose.procedures ?? loose.unmapped ?? [],
        "Review and enter the procedures from the legacy publication."
      ),
      purpose: looseParagraphs(
        loose.purpose ?? [],
        "This publication establishes local procedures for the converted legacy policy."
      ),
      applicability: looseParagraphs(
        loose.applicability ?? [],
        "This publication applies to General Leonard Wood Community Hospital, outlying clinics, and assigned or attached personnel."
      )
    };
  }
  const purposeSection = findTopSection(sections, /^Purpose\b/i);
  const applicabilitySection = findTopSection(sections, /^Applicability\b/i);
  const referenceSection = findTopSection(sections, /^References\b/i);
  const responsibilitySection = findTopSection(sections, /^Responsibilities\b/i);
  const procedureSections = sections.filter((section) => {
    const title = nodeTitle(section);
    return !/^(Purpose|References|Applicability|Responsibilities)\b/i.test(title);
  });

  return {
    identity,
    lines,
    sections,
    references: referenceSection ? collectReferenceText(referenceSection) : [],
    responsibilities: responsibilitySection
      ? responsibilitySection.children.map(paragraphFromNode)
      : [],
    procedures: procedureSections.map(paragraphFromNode),
    purpose: purposeSection
      ? [sectionBodyParagraph(purposeSection)]
      : [plainParagraph("This publication establishes local procedures for the converted legacy policy.")],
    applicability: applicabilitySection
      ? [sectionBodyParagraph(applicabilitySection)]
      : [
          plainParagraph(
            "This publication applies to General Leonard Wood Community Hospital, outlying clinics, and assigned or attached personnel."
          )
        ]
  };
}
