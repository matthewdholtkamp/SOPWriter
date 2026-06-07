import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import type { ParagraphNode, SopSpec } from "../model/sopSpec";
import { nonEmptyParagraphs } from "../model/sopSpec";
import { validateSop } from "../validation/validate";
import {
  INDENT_STEP,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  SIGNATURE_LEFT,
  publicationKindLabel,
  publicationShortLabel,
  sopLabel
} from "./format";

const TEMPLATE_PATH = "assets/templates/glwch-publication-template.docx";
const BODY_TABS =
  '<w:tabs><w:tab w:val="left" w:pos="360"/><w:tab w:val="left" w:pos="720"/><w:tab w:val="left" w:pos="1080"/><w:tab w:val="left" w:pos="1440"/><w:tab w:val="left" w:pos="1800"/><w:tab w:val="left" w:pos="2160"/></w:tabs>';

type RunInput = string | { text: string; bold?: boolean; italics?: boolean };

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function run(input: RunInput): string {
  const value = typeof input === "string" ? { text: input } : input;
  const runProps = [
    value.bold ? "<w:b/><w:bCs/>" : "",
    value.italics ? "<w:i/><w:iCs/>" : ""
  ].join("");
  const xmlSpace = /^\s|\s$|\s{2,}/.test(value.text) ? ' xml:space="preserve"' : "";
  return `<w:r>${runProps ? `<w:rPr>${runProps}</w:rPr>` : ""}<w:t${xmlSpace}>${escapeXml(value.text)}</w:t></w:r>`;
}

function paragraph(
  runs: RunInput[] = [],
  options: {
    after?: number;
    before?: number;
    bold?: boolean;
    center?: boolean;
    firstLine?: number;
    hanging?: number;
    keepNext?: boolean;
    left?: number;
    pageBreakBefore?: boolean;
    right?: number;
    style?: string;
    tabs?: boolean;
  } = {}
): string {
  const pPr = [
    options.style ? `<w:pStyle w:val="${options.style}"/>` : "",
    options.keepNext ? "<w:keepNext/>" : "",
    options.pageBreakBefore ? "<w:pageBreakBefore/>" : "",
    options.tabs ? BODY_TABS : "",
    options.before !== undefined || options.after !== undefined
      ? `<w:spacing${options.before !== undefined ? ` w:before="${options.before}"` : ""}${options.after !== undefined ? ` w:after="${options.after}"` : ""}/>`
      : "",
    options.left !== undefined || options.right !== undefined || options.firstLine !== undefined || options.hanging !== undefined
      ? `<w:ind${options.left !== undefined ? ` w:left="${options.left}"` : ""}${options.right !== undefined ? ` w:right="${options.right}"` : ""}${options.firstLine !== undefined ? ` w:firstLine="${options.firstLine}"` : ""}${options.hanging !== undefined ? ` w:hanging="${options.hanging}"` : ""}/>`
      : "",
    options.center ? '<w:jc w:val="center"/>' : "",
    options.bold ? "<w:rPr><w:b/><w:bCs/></w:rPr>" : ""
  ].join("");
  return `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ""}${runs.map(run).join("")}</w:p>`;
}

function emptyParagraph(): string {
  return paragraph();
}

function emptyParagraphs(count: number): string[] {
  return Array.from({ length: count }, () => emptyParagraph());
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

function designation(spec: SopSpec, short = false): string {
  const kind = short ? publicationShortLabel(spec.documentType) : publicationKindLabel(spec.documentType);
  const number = spec.publicationNumber.trim() || "[NUMBER]";
  return `GLWCH ${kind} No. ${number}`;
}

function releasabilityText(value: SopSpec["sections"]["releasability"]): string {
  return value === "public"
    ? "Cleared for public release."
    : "Not cleared for public release.";
}

function nodeRuns(node: ParagraphNode): RunInput[] {
  const heading = node.heading?.trim();
  const text = node.text.trim();
  if (!heading) return [text];
  return text
    ? [{ text: `${heading}.  `, bold: true }, text]
    : [{ text: heading, bold: true }];
}

function numberedNodes(nodes: ParagraphNode[], depth = 0): string[] {
  const paragraphs: string[] = [];
  nodes.forEach((node, index) => {
    paragraphs.push(
      paragraph([`${sopLabel(depth, index + 1)}  `, ...nodeRuns(node)], {
        after: 120,
        firstLine: depth * INDENT_STEP,
        keepNext: node.children.length > 0,
        tabs: true
      })
    );
    paragraphs.push(...numberedNodes(node.children, depth + 1));
  });
  return paragraphs;
}

function aboveSignatureSection(sectionNumber: number, title: string, nodes: ParagraphNode[] | null): string[] {
  const visible = nonEmptyParagraphs(nodes);
  if (!visible.length) return [];
  const [first, ...rest] = visible;
  return [
    paragraph([{ text: `${sectionNumber}.  ${title}.  `, bold: true }, ...nodeRuns(first)], {
      after: 120,
      tabs: true
    }),
    ...numberedNodes(first.children, 1),
    ...numberedNodes(rest, 1)
  ];
}

function effectiveDateSection(sectionNumber: number, spec: SopSpec): string {
  const firstSentence = spec.sections.effectiveDate.effectiveOnSignature
    ? `This ${designation(spec, true)} is effective upon signature.`
    : `This ${designation(spec, true)} is effective on the date specified by the approval authority.`;
  const secondSentence = `It will expire ${spec.sections.effectiveDate.expiresYears} years from the date of signature if not reissued or canceled.`;
  return paragraph([{ text: `${sectionNumber}.  EFFECTIVE DATE.  `, bold: true }, `${firstSentence}  ${secondSentence}`], {
    after: 120,
    tabs: true
  });
}

function aboveSignatureSections(spec: SopSpec): string[] {
  const sections: string[] = [];
  let number = 1;
  const append = (title: string, nodes: ParagraphNode[] | null) => {
    const paragraphs = aboveSignatureSection(number, title, nodes);
    if (paragraphs.length) {
      sections.push(...paragraphs);
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
  sections.push(
    paragraph([{ text: `${number}.  RELEASABILITY.  `, bold: true }, releasabilityText(spec.sections.releasability)], {
      after: 120,
      tabs: true
    })
  );
  number += 1;
  sections.push(effectiveDateSection(number, spec));
  number += 1;
  append("FORMS", spec.sections.forms);
  append("SUMMARY OF CHANGES", spec.sections.summaryOfChanges);
  return sections;
}

function publicationHeader(spec: SopSpec): string[] {
  const subject = spec.subject.trim() || "[SUBJECT]";
  return [
    paragraph(["Defense Health Agency"], { center: true, style: "Caption" }),
    paragraph(["General Leonard Wood Community Hospital"], { center: true }),
    emptyParagraph(),
    paragraph([designation(spec)], { center: true, style: "Heading1" }),
    paragraph([spec.date.trim() || "[DATE]"], { center: true }),
    emptyParagraph(),
    paragraph([spec.proponent.trim() || "[PROPONENT]"], { after: 120 }),
    paragraph([{ text: "SUBJECT:\t", bold: true }, subject], { after: 120, tabs: true }),
    paragraph([{ text: "References:\t", bold: true }, "See Enclosure 1."], { after: 240, tabs: true })
  ];
}

function signature(spec: SopSpec): string[] {
  return [
    ...emptyParagraphs(6),
    paragraph([spec.signature.name.trim().toUpperCase()], { keepNext: true, left: SIGNATURE_LEFT }),
    paragraph([spec.signature.rankBranch.trim()], { keepNext: true, left: SIGNATURE_LEFT }),
    ...spec.signature.title.map((title, index) =>
      paragraph([title.trim()], {
        keepNext: index < spec.signature.title.length - 1,
        left: SIGNATURE_LEFT + (index === 0 ? 0 : INDENT_STEP)
      })
    )
  ];
}

function enclosureHeading(number: number, title: string, pageBreakBefore = true): string[] {
  return [
    paragraph([`ENCLOSURE ${number}`], { after: 120, center: true, pageBreakBefore }),
    paragraph([title.toUpperCase()], { after: 240, center: true }),
    emptyParagraph()
  ];
}

function references(spec: SopSpec): string[] {
  return [
    ...enclosureHeading(1, "References"),
    ...spec.references
      .map((reference) => reference.trim())
      .filter(Boolean)
      .map((reference, index) =>
        paragraph([`(${String.fromCharCode(97 + index)})\t${reference}`], {
          after: 120,
          hanging: 518,
          left: 518,
          tabs: true
        })
      )
  ];
}

function responsibilities(spec: SopSpec): string[] {
  return [
    ...enclosureHeading(2, "Responsibilities"),
    ...numberedNodes(nonEmptyParagraphs(spec.enclosures.responsibilities))
  ];
}

function procedures(spec: SopSpec): string[] {
  const paragraphs = [
    ...enclosureHeading(3, "Procedures"),
    ...numberedNodes(nonEmptyParagraphs(spec.enclosures.procedures))
  ];
  spec.enclosures.appendices.forEach((appendix, index) => {
    const title =
      spec.enclosures.appendices.length === 1
        ? `APPENDIX: ${appendix.title.toUpperCase()}`
        : `APPENDIX ${index + 1}: ${appendix.title.toUpperCase()}`;
    paragraphs.push(
      emptyParagraph(),
      paragraph([title], { after: 120, center: true }),
      ...numberedNodes(nonEmptyParagraphs(appendix.body))
    );
  });
  return paragraphs;
}

function glossary(spec: SopSpec): string[] {
  const acronyms = [...spec.glossary.acronyms]
    .filter((entry) => entry.term.trim() && entry.meaning.trim())
    .sort((a, b) => a.term.localeCompare(b.term));
  const definitions = [...spec.glossary.definitions]
    .filter((entry) => entry.term.trim() && entry.definition.trim())
    .sort((a, b) => a.term.localeCompare(b.term));
  if (!acronyms.length && !definitions.length) return [];

  const paragraphs = [
    paragraph(["GLOSSARY"], { after: 240, center: true, pageBreakBefore: true })
  ];
  if (acronyms.length) {
    paragraphs.push(
      paragraph([definitions.length ? "PART I.  ABBREVIATIONS AND ACRONYMS" : "ABBREVIATIONS AND ACRONYMS"], {
        after: 120
      }),
      ...acronyms.map((entry) => paragraph([`${entry.term.trim()}\t${entry.meaning.trim()}`], { after: 120 }))
    );
  }
  if (definitions.length) {
    paragraphs.push(
      emptyParagraph(),
      paragraph([acronyms.length ? "PART II.  DEFINITIONS" : "DEFINITIONS"], { after: 120 }),
      ...definitions.map((entry) =>
        paragraph([{ text: `${entry.term.trim()}.  `, bold: true }, entry.definition.trim()], { after: 120 })
      )
    );
  }
  return paragraphs;
}

function sectionProperties(templateDocument: string): string {
  const match = templateDocument.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/);
  const fallback = `<w:sectPr><w:headerReference w:type="even" r:id="rId14"/><w:headerReference w:type="default" r:id="rId15"/><w:footerReference w:type="even" r:id="rId16"/><w:footerReference w:type="default" r:id="rId17"/><w:headerReference w:type="first" r:id="rId18"/><w:footerReference w:type="first" r:id="rId19"/><w:pgSz w:w="${PAGE_WIDTH}" w:h="${PAGE_HEIGHT}" w:code="1"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/><w:cols w:space="720"/><w:titlePg/></w:sectPr>`;
  return (match?.[0] ?? fallback).replace(/<w:type w:val="continuous"\/>/, "");
}

function buildDocumentXml(templateDocument: string, spec: SopSpec): string {
  const bodyStart = templateDocument.indexOf("<w:body>");
  const bodyEnd = templateDocument.lastIndexOf("</w:body>");
  if (bodyStart < 0 || bodyEnd < 0) throw new Error("The GLWCH Word template is missing a document body.");

  const prefix = templateDocument.slice(0, bodyStart + "<w:body>".length);
  const suffix = templateDocument.slice(bodyEnd);
  const body = [
    ...publicationHeader(spec),
    ...aboveSignatureSections(spec),
    ...signature(spec),
    ...references(spec),
    ...responsibilities(spec),
    ...procedures(spec),
    ...glossary(spec),
    sectionProperties(templateDocument)
  ].join("");

  return `${prefix}${body}${suffix}`;
}

export async function buildTemplateDocx(spec: SopSpec): Promise<Blob> {
  const validation = validateSop(spec);
  if (!validation.canGenerate) {
    throw new Error(
      `Cannot generate publication: ${validation.blockingErrors
        .map(({ label }) => label)
        .join(", ")}`
    );
  }

  const archive = unzipSync(await loadTemplateBytes());
  const templateDocument = strFromU8(archive["word/document.xml"]);
  archive["word/document.xml"] = strToU8(buildDocumentXml(templateDocument, spec));
  return new Blob([zipSync(archive, { level: 6 })], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  });
}
