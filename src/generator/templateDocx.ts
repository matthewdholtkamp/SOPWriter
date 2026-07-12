import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import type { ParagraphNode, SopSpec } from "../model/sopSpec";
import { nonEmptyParagraphs } from "../model/sopSpec";
import { validateSop } from "../validation/validate";
import { publicationKindLabel, publicationShortLabel, sopLabel } from "./format";

const TEMPLATE_PATH = "assets/templates/glwch-publication-template.docx";
const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const XML_NS = "http://www.w3.org/XML/1998/namespace";

type XmlDocument = Document;
type XmlElement = Element;
type XmlNode = Node;

type RunPart =
  | { tab: true }
  | { text: string; bold?: boolean; italics?: boolean; underline?: boolean };

type ParagraphPrototypes = {
  aboveSection: XmlElement;
  blank: XmlElement;
  numbered: XmlElement[];
};

function parseXml(xml: string): XmlDocument {
  if (!globalThis.DOMParser) throw new Error("The XML document runtime is not available.");
  return new globalThis.DOMParser().parseFromString(xml, "application/xml");
}

function serializeXml(document: XmlDocument): string {
  if (!globalThis.XMLSerializer) throw new Error("The XML serializer runtime is not available.");
  return new globalThis.XMLSerializer().serializeToString(document);
}

function localName(node: XmlNode): string {
  return (node as XmlElement).localName ?? node.nodeName.split(":").at(-1) ?? node.nodeName;
}

function directElements(node: XmlNode): XmlElement[] {
  const elements: XmlElement[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 1) elements.push(child as XmlElement);
  }
  return elements;
}

function elementsByTag(node: XmlNode, name: string): XmlElement[] {
  const list = (node as XmlElement).getElementsByTagNameNS(W_NS, name);
  return Array.from({ length: list.length }, (_, index) => list.item(index) as XmlElement);
}

function firstByTag(node: XmlNode, name: string): XmlElement {
  const element = elementsByTag(node, name)[0];
  if (!element) throw new Error(`The GLWCH Word template is missing w:${name}.`);
  return element;
}

function wordText(node: XmlNode): string {
  return elementsByTag(node, "t")
    .map((element) => element.textContent ?? "")
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function cloneElement(element: XmlElement): XmlElement {
  return element.cloneNode(true) as XmlElement;
}

function stripGeneratedIdentity(node: XmlElement): void {
  for (const element of [node, ...elementsByTag(node, "p")]) {
    const attributes = Array.from({ length: element.attributes.length }, (_, index) => element.attributes.item(index));
    attributes.forEach((attribute) => {
      if (!attribute) return;
      const name = attribute.localName ?? attribute.name.split(":").at(-1) ?? attribute.name;
      if (name === "paraId" || name === "textId" || name.startsWith("rsid")) {
        element.removeAttributeNode(attribute);
      }
    });
  }
}

function findParagraph(
  body: XmlElement,
  predicate: (text: string) => boolean,
  position: "first" | "last" = "first"
): XmlElement {
  const matches = directElements(body).filter(
    (element) => localName(element) === "p" && predicate(wordText(element))
  );
  const paragraph = position === "last" ? matches.at(-1) : matches[0];
  if (!paragraph) throw new Error("The GLWCH Word template is missing a required paragraph prototype.");
  return paragraph;
}

function paragraphStarting(body: XmlElement, text: string, position: "first" | "last" = "first"): XmlElement {
  const expected = normalizedText(text);
  return findParagraph(body, (value) => value.startsWith(expected), position);
}

function paragraphEqualTo(body: XmlElement, text: string, position: "first" | "last" = "first"): XmlElement {
  const expected = normalizedText(text);
  return findParagraph(body, (value) => value === expected, position);
}

function clearParagraph(paragraph: XmlElement): void {
  for (const child of [...directElements(paragraph)]) {
    if (localName(child) !== "pPr") paragraph.removeChild(child);
  }
}

function appendRun(document: XmlDocument, paragraph: XmlElement, part: RunPart): void {
  const run = document.createElementNS(W_NS, "w:r");
  if ("tab" in part) {
    run.appendChild(document.createElementNS(W_NS, "w:tab"));
    paragraph.appendChild(run);
    return;
  }

  if (part.bold || part.italics || part.underline) {
    const properties = document.createElementNS(W_NS, "w:rPr");
    if (part.bold) properties.appendChild(document.createElementNS(W_NS, "w:b"));
    if (part.italics) properties.appendChild(document.createElementNS(W_NS, "w:i"));
    if (part.underline) {
      const underline = document.createElementNS(W_NS, "w:u");
      underline.setAttributeNS(W_NS, "w:val", "single");
      properties.appendChild(underline);
    }
    run.appendChild(properties);
  }

  const text = document.createElementNS(W_NS, "w:t");
  if (/^\s|\s$|\s{2,}/.test(part.text)) text.setAttributeNS(XML_NS, "xml:space", "preserve");
  text.appendChild(document.createTextNode(part.text));
  run.appendChild(text);
  paragraph.appendChild(run);
}

function paragraphFrom(
  document: XmlDocument,
  prototype: XmlElement,
  parts: RunPart[],
  keepNext = false
): XmlElement {
  const paragraph = cloneElement(prototype);
  stripGeneratedIdentity(paragraph);
  clearParagraph(paragraph);
  if (keepNext) {
    const properties = elementsByTag(paragraph, "pPr")[0] ?? (() => {
      const created = document.createElementNS(W_NS, "w:pPr");
      paragraph.insertBefore(created, paragraph.firstChild);
      return created;
    })();
    if (!elementsByTag(properties, "keepNext").length) {
      properties.appendChild(document.createElementNS(W_NS, "w:keepNext"));
    }
  }
  parts.forEach((part) => appendRun(document, paragraph, part));
  return paragraph;
}

function blankParagraph(document: XmlDocument, prototype: XmlElement): XmlElement {
  return paragraphFrom(document, prototype, []);
}

function appendNodes(parent: XmlElement, nodes: XmlElement[]): void {
  nodes.forEach((node) => parent.appendChild(node));
}

function cleanHeading(value: string | undefined): string {
  return (value ?? "").trim().replace(/[.]+$/, "");
}

function nodeParts(node: ParagraphNode): RunPart[] {
  const heading = cleanHeading(node.heading);
  const text = node.text.trim();
  if (!heading) return text ? [{ text }] : [];
  if (!text) return [{ text: heading, underline: true }];
  return [
    { text: heading, underline: true },
    { text: ".  " },
    { text }
  ];
}

function numberedNodes(
  document: XmlDocument,
  nodes: ParagraphNode[],
  prototypes: XmlElement[],
  depth = 0
): XmlElement[] {
  const paragraphs: XmlElement[] = [];
  nodes.forEach((node, index) => {
    const prototype = prototypes[Math.min(depth, prototypes.length - 1)];
    paragraphs.push(
      paragraphFrom(
        document,
        prototype,
        [{ text: `${sopLabel(depth, index + 1)}  ` }, ...nodeParts(node)],
        node.children.length > 0
      )
    );
    paragraphs.push(...numberedNodes(document, node.children, prototypes, depth + 1));
  });
  return paragraphs;
}

function sectionParagraphs(
  document: XmlDocument,
  sectionNumber: number,
  title: string,
  nodes: ParagraphNode[] | null,
  prototypes: ParagraphPrototypes
): XmlElement[] {
  const visible = nonEmptyParagraphs(nodes);
  if (!visible.length) return [];
  const [first, ...rest] = visible;
  const content = nodeParts(first);
  const paragraphs = [
    paragraphFrom(
      document,
      prototypes.aboveSection,
      [
        { text: `${sectionNumber}.  ` },
        { text: title, underline: true },
        ...(content.length ? [{ text: ".  " } as RunPart, ...content] : [])
      ],
      first.children.length > 0
    )
  ];
  paragraphs.push(...numberedNodes(document, first.children, prototypes.numbered, 1));
  paragraphs.push(...numberedNodes(document, rest, prototypes.numbered, 1));
  return paragraphs;
}

function designation(spec: SopSpec, short = false): string {
  const kind = short ? publicationShortLabel(spec.documentType) : publicationKindLabel(spec.documentType);
  return `GLWCH ${kind} No. ${spec.publicationNumber.trim() || "[NUMBER]"}`;
}

function runningDesignation(spec: SopSpec): string {
  const kind = spec.documentType === "regulation" ? "Reg" : "Pam";
  return `GLWCH ${kind} ${spec.publicationNumber.trim() || "[NUMBER]"}`;
}

function publicationTypeTitle(spec: SopSpec): string {
  return spec.documentType === "regulation" ? "REGULATION" : "PAMPHLET";
}

function releasabilityText(value: SopSpec["sections"]["releasability"]): string {
  return value === "public" ? "Cleared for public release." : "Not cleared for public release.";
}

function signatureParts(text: string): RunPart[] {
  return [...Array.from({ length: 6 }, () => ({ tab: true }) as RunPart), { text }];
}

function aboveSignatureSections(
  document: XmlDocument,
  spec: SopSpec,
  prototypes: ParagraphPrototypes
): XmlElement[] {
  const paragraphs: XmlElement[] = [];
  let number = 1;
  const append = (title: string, nodes: ParagraphNode[] | null) => {
    const section = sectionParagraphs(document, number, title, nodes, prototypes);
    if (section.length) {
      paragraphs.push(...section);
      number += 1;
    }
  };

  append("PURPOSE", spec.sections.purpose);
  append("APPLICABILITY", spec.sections.applicability);
  append("POLICY IMPLEMENTATION", spec.sections.policyImplementation);
  append("CANCELED DOCUMENTS", spec.sections.canceledDocuments);
  append("RESPONSIBILITIES", spec.sections.responsibilitiesBrief);
  append("PROCEDURES", spec.sections.proceduresBrief);
  append("INFORMATION COLLECTION", spec.sections.informationCollection);
  append("PROPONENT AND WAIVERS", spec.sections.proponentAndWaivers);
  paragraphs.push(
    ...sectionParagraphs(
      document,
      number,
      "RELEASABILITY",
      [{ text: releasabilityText(spec.sections.releasability), children: [] }],
      prototypes
    )
  );
  number += 1;

  const effectiveLead = `This ${designation(spec, true)}:`;
  const effectiveChildren: ParagraphNode[] = [
    {
      text: spec.sections.effectiveDate.effectiveOnSignature
        ? "Is effective upon signature."
        : "Is effective on the date specified by the approval authority.",
      children: []
    },
    {
      text: `Will expire ${spec.sections.effectiveDate.expiresYears} years from the date of signature if it has not been reissued or canceled before that date.`,
      children: []
    }
  ];
  paragraphs.push(
    ...sectionParagraphs(
      document,
      number,
      "EFFECTIVE DATE",
      [{ text: effectiveLead, children: effectiveChildren }],
      prototypes
    )
  );
  number += 1;
  append("FORMS", spec.sections.forms);
  append("SUMMARY OF CHANGES", spec.sections.summaryOfChanges);
  return paragraphs;
}

function sectionBreakParagraph(document: XmlDocument, prototype: XmlElement): XmlElement {
  const paragraph = paragraphFrom(document, prototype, []);
  const type = elementsByTag(paragraph, "type").find(
    (element) => element.parentNode && localName(element.parentNode) === "sectPr"
  );
  if (type?.getAttributeNS(W_NS, "val") === "continuous") type.parentNode?.removeChild(type);
  return paragraph;
}

function finalSectionProperties(prototype: XmlElement): XmlElement {
  const properties = cloneElement(firstByTag(prototype, "sectPr"));
  const type = elementsByTag(properties, "type")[0];
  if (type?.getAttributeNS(W_NS, "val") === "continuous") type.parentNode?.removeChild(type);
  return properties;
}

function enclosureHeading(
  document: XmlDocument,
  headingPrototype: XmlElement,
  titlePrototype: XmlElement,
  blankPrototype: XmlElement,
  number: number,
  title: string
): XmlElement[] {
  return [
    paragraphFrom(document, headingPrototype, [{ text: `ENCLOSURE ${number}`, underline: true }]),
    blankParagraph(document, blankPrototype),
    paragraphFrom(document, titlePrototype, [{ text: title.toUpperCase(), underline: true }]),
    blankParagraph(document, blankPrototype),
    blankParagraph(document, blankPrototype)
  ];
}

function referenceLabel(index: number): string {
  return String.fromCharCode(97 + Math.min(index, 25));
}

function patchRunningHeader(archive: Record<string, Uint8Array>, spec: SopSpec): void {
  const path = "word/header2.xml";
  const document = parseXml(strFromU8(archive[path]));
  const paragraphs = elementsByTag(document, "p");
  if (paragraphs.length < 2) throw new Error("The GLWCH Word template has an invalid continuation header.");
  const first = paragraphFrom(document, paragraphs[0], [{ text: runningDesignation(spec), italics: true }]);
  const second = paragraphFrom(document, paragraphs[1], [{ text: spec.date.trim() || "[DATE]", italics: true }]);
  paragraphs[0].parentNode?.replaceChild(first, paragraphs[0]);
  paragraphs[1].parentNode?.replaceChild(second, paragraphs[1]);
  archive[path] = strToU8(serializeXml(document));

  archive["word/footer3.xml"] = archive["word/footer1.xml"];

  const enclosureThreeFooter = parseXml(strFromU8(archive["word/footer6.xml"]));
  const footerText = elementsByTag(enclosureThreeFooter, "t");
  const enclosureLabel = footerText.find((element) => element.textContent?.includes("ENCLOSURE 2"));
  if (!enclosureLabel) throw new Error("The GLWCH Word template has an invalid enclosure footer.");
  enclosureLabel.textContent = "ENCLOSURE 3";
  archive["word/footer7.xml"] = strToU8(serializeXml(enclosureThreeFooter));
}

function buildDocumentXml(templateDocument: string, spec: SopSpec): string {
  const document = parseXml(templateDocument);
  const body = firstByTag(document, "body");
  const originalChildren = directElements(body);
  if (originalChildren.length < 12 || wordText(originalChildren[0]) !== "Defense Health Agency") {
    throw new Error("The GLWCH Word template cover structure has changed.");
  }

  const titleControl = originalChildren.find((element) => localName(element) === "sdt");
  if (!titleControl) throw new Error("The GLWCH Word template is missing the publication type title.");
  const titleParagraph = firstByTag(titleControl, "p");
  const sectionBreaks = originalChildren.filter(
    (element) => localName(element) === "p" && elementsByTag(element, "sectPr").length > 0
  );
  if (sectionBreaks.length < 7) throw new Error("The GLWCH Word template is missing enclosure section definitions.");

  const blankPrototype = originalChildren[4];
  const numberedPrototypes = [
    paragraphStarting(body, "1.  SECTION TITLE."),
    paragraphStarting(body, "a.  Paragraph Heading."),
    paragraphStarting(body, "(1)  Use tab stop increments"),
    paragraphStarting(body, "(a)  Paragraph Heading."),
    paragraphStarting(body, "1.  Paragraph Heading"),
    paragraphStarting(body, "a.  This is the fifth level.")
  ];
  const prototypes: ParagraphPrototypes = {
    aboveSection: paragraphStarting(body, "1.  PURPOSE."),
    blank: blankPrototype,
    numbered: numberedPrototypes
  };

  const signatureName = paragraphEqualTo(body, "FIRST LAST");
  const signatureRank = paragraphEqualTo(body, "COL, USA");
  const signatureTitle = paragraphEqualTo(body, "Director");
  const enclosureListHeading = paragraphStarting(body, "Enclosures  Delete");
  const enclosureListItems = [
    paragraphStarting(body, "1.  References"),
    paragraphStarting(body, "2.  Responsibilities"),
    paragraphEqualTo(body, "3.  Procedures")
  ];

  const referenceHeading = paragraphEqualTo(body, "ENCLOSURE 1", "last");
  const referenceTitle = paragraphEqualTo(body, "REFERENCES");
  const referenceItem = paragraphStarting(body, "(a)DoD Directive");
  const procedureTitle = paragraphEqualTo(body, "PROCEDURES");
  const glossaryHeading = paragraphEqualTo(body, "GLOSSARY");
  const acronymPart = paragraphEqualTo(body, "PART I.  ABBREVIATIONS AND ACRONYMS");
  const definitionPart = paragraphEqualTo(body, "PART II.  DEFINITIONS");
  const acronymItem = paragraphStarting(body, "MTFmilitary medical treatment");
  const definitionItem = paragraphStarting(body, "ACRONYM.  Use acronyms already");

  while (body.firstChild) body.removeChild(body.firstChild);

  body.appendChild(cloneElement(originalChildren[0]));
  body.appendChild(cloneElement(originalChildren[1]));
  body.appendChild(cloneElement(originalChildren[2]));
  body.appendChild(
    paragraphFrom(document, titleParagraph, [{ text: publicationTypeTitle(spec), bold: true }])
  );
  body.appendChild(cloneElement(originalChildren[4]));
  body.appendChild(cloneElement(originalChildren[5]));
  body.appendChild(
    paragraphFrom(document, originalChildren[6], [
      { text: `NUMBER ${spec.publicationNumber.trim() || "[NUMBER]"}`, bold: true }
    ])
  );
  body.appendChild(
    paragraphFrom(document, originalChildren[7], [{ text: spec.date.trim() || "[DATE]" }])
  );
  body.appendChild(cloneElement(originalChildren[8]));
  body.appendChild(
    paragraphFrom(document, originalChildren[9], [{ text: spec.proponent.trim() || "[PROPONENT]" }])
  );
  body.appendChild(
    paragraphFrom(document, originalChildren[10], [
      { text: "SUBJECT:" },
      { tab: true },
      { text: spec.subject.trim() || "[SUBJECT]" }
    ])
  );
  body.appendChild(
    paragraphFrom(document, originalChildren[11], [
      { text: "References:" },
      { tab: true },
      { text: "See Enclosure 1." }
    ])
  );

  appendNodes(body, aboveSignatureSections(document, spec, prototypes));
  for (let index = 0; index < 6; index += 1) {
    body.appendChild(blankParagraph(document, prototypes.blank));
  }
  body.appendChild(
    paragraphFrom(
      document,
      signatureName,
      signatureParts(spec.signature.name.trim().toUpperCase()),
      true
    )
  );
  body.appendChild(
    paragraphFrom(document, signatureRank, signatureParts(spec.signature.rankBranch.trim()), true)
  );
  spec.signature.title.forEach((title, index) => {
    body.appendChild(
      paragraphFrom(
        document,
        signatureTitle,
        signatureParts(title.trim()),
        index < spec.signature.title.length - 1
      )
    );
  });
  body.appendChild(blankParagraph(document, prototypes.blank));
  body.appendChild(paragraphFrom(document, enclosureListHeading, [{ text: "Enclosures" }]));
  ["1.  References", "2.  Responsibilities", "3.  Procedures"].forEach((text, index) => {
    body.appendChild(paragraphFrom(document, enclosureListItems[index], [{ text }]));
  });
  const hasGlossary = spec.glossary.acronyms.some((entry) => entry.term.trim() && entry.meaning.trim()) ||
    spec.glossary.definitions.some((entry) => entry.term.trim() && entry.definition.trim());
  if (hasGlossary) body.appendChild(paragraphFrom(document, enclosureListItems[2], [{ text: "Glossary" }]));
  body.appendChild(sectionBreakParagraph(document, sectionBreaks[0]));

  appendNodes(
    body,
    enclosureHeading(document, referenceHeading, referenceTitle, prototypes.blank, 1, "References")
  );
  spec.references
    .map((reference) => reference.trim())
    .filter(Boolean)
    .forEach((reference, index) => {
      body.appendChild(
        paragraphFrom(document, referenceItem, [
          { text: `(${referenceLabel(index)})` },
          { tab: true },
          { text: reference }
        ])
      );
    });
  body.appendChild(sectionBreakParagraph(document, sectionBreaks[2]));

  appendNodes(
    body,
    enclosureHeading(document, referenceHeading, referenceTitle, prototypes.blank, 2, "Responsibilities")
  );
  appendNodes(
    body,
    numberedNodes(document, nonEmptyParagraphs(spec.enclosures.responsibilities), numberedPrototypes)
  );
  body.appendChild(sectionBreakParagraph(document, sectionBreaks[3]));

  appendNodes(
    body,
    enclosureHeading(document, referenceHeading, referenceTitle, prototypes.blank, 3, "Procedures")
  );
  appendNodes(body, numberedNodes(document, nonEmptyParagraphs(spec.enclosures.procedures), numberedPrototypes));
  spec.enclosures.appendices.forEach((appendix, index) => {
    body.appendChild(blankParagraph(document, prototypes.blank));
    const label = spec.enclosures.appendices.length === 1 ? "APPENDIX" : `APPENDIX ${index + 1}`;
    body.appendChild(paragraphFrom(document, procedureTitle, [{ text: label, underline: true }]));
    body.appendChild(
      paragraphFrom(document, procedureTitle, [{ text: appendix.title.trim().toUpperCase(), underline: true }])
    );
    body.appendChild(blankParagraph(document, prototypes.blank));
    appendNodes(body, numberedNodes(document, nonEmptyParagraphs(appendix.body), numberedPrototypes));
  });

  if (hasGlossary) {
    body.appendChild(sectionBreakParagraph(document, sectionBreaks[5]));
    body.appendChild(paragraphFrom(document, glossaryHeading, [{ text: "GLOSSARY", underline: true }]));
    body.appendChild(blankParagraph(document, prototypes.blank));
    const acronyms = [...spec.glossary.acronyms]
      .filter((entry) => entry.term.trim() && entry.meaning.trim())
      .sort((a, b) => a.term.localeCompare(b.term));
    const definitions = [...spec.glossary.definitions]
      .filter((entry) => entry.term.trim() && entry.definition.trim())
      .sort((a, b) => a.term.localeCompare(b.term));
    if (acronyms.length) {
      const heading = definitions.length ? "PART I.  ABBREVIATIONS AND ACRONYMS" : "ABBREVIATIONS AND ACRONYMS";
      body.appendChild(paragraphFrom(document, acronymPart, [{ text: heading, underline: true }]));
      body.appendChild(blankParagraph(document, prototypes.blank));
      acronyms.forEach((entry) => {
        body.appendChild(
          paragraphFrom(document, acronymItem, [
            { text: entry.term.trim() },
            { tab: true },
            { text: entry.meaning.trim() }
          ])
        );
      });
    }
    if (definitions.length) {
      if (acronyms.length) body.appendChild(blankParagraph(document, prototypes.blank));
      const heading = acronyms.length ? "PART II.  DEFINITIONS" : "DEFINITIONS";
      body.appendChild(paragraphFrom(document, definitionPart, [{ text: heading, underline: true }]));
      body.appendChild(blankParagraph(document, prototypes.blank));
      definitions.forEach((entry) => {
        body.appendChild(
          paragraphFrom(document, definitionItem, [
            { text: `${cleanHeading(entry.term)}.`, underline: true },
            { text: "  " },
            { text: entry.definition.trim() }
          ])
        );
      });
    }
    body.appendChild(finalSectionProperties(sectionBreaks[6]));
  } else {
    body.appendChild(finalSectionProperties(sectionBreaks[5]));
  }

  return serializeXml(document);
}

async function loadTemplateBytes(): Promise<Uint8Array> {
  if (import.meta.env.MODE !== "test" && typeof window !== "undefined" && typeof fetch === "function") {
    const response = await fetch(`${import.meta.env.BASE_URL}${TEMPLATE_PATH}`);
    if (!response.ok) throw new Error("Could not load the GLWCH Word template.");
    return new Uint8Array(await response.arrayBuffer());
  }

  const { readFile } = await import(/* @vite-ignore */ "node:fs/promises");
  return readFile(`${process.cwd()}/public/assets/templates/glwch-publication-template.docx`);
}

export async function buildTemplateDocx(spec: SopSpec): Promise<Blob> {
  const validation = validateSop(spec);
  if (!validation.canGenerate) {
    throw new Error(
      `Cannot generate publication: ${validation.blockingErrors.map(({ label }) => label).join(", ")}`
    );
  }

  const archive = unzipSync(await loadTemplateBytes());
  const templateDocument = strFromU8(archive["word/document.xml"]);
  archive["word/document.xml"] = strToU8(buildDocumentXml(templateDocument, spec));
  patchRunningHeader(archive, spec);
  return new Blob([zipSync(archive, { level: 6 })], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  });
}
