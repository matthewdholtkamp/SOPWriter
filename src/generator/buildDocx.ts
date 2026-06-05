import {
  AlignmentType,
  Document,
  Footer,
  Header,
  ImageRun,
  Packer,
  PageNumber,
  Paragraph,
  TextRun,
  type FileChild,
  type IParagraphOptions,
  type ParagraphChild
} from "docx";
import type { DocumentType, ParagraphNode, SopSpec } from "../model/sopSpec";
import { nonEmptyParagraphs } from "../model/sopSpec";
import { validateSop } from "../validation/validate";
import {
  HEADER_FOOTER_MARGIN,
  INDENT_STEP,
  MARGIN,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  PARAGRAPH_AFTER,
  SIGNATURE_LEFT,
  SINGLE_LINE,
  publicationKindLabel,
  publicationShortLabel,
  sopLabel
} from "./format";

const FONT = "Arial";
const FONT_SIZE_PT = 12;
const SEAL_SIZE = 72;

function run(text: string, options: { bold?: boolean; italics?: boolean } = {}): TextRun {
  return new TextRun({
    text,
    font: FONT,
    size: FONT_SIZE_PT * 2,
    bold: options.bold,
    italics: options.italics
  });
}

function sopParagraph(
  children: ParagraphChild[] = [],
  options: Omit<IParagraphOptions, "children"> = {}
): Paragraph {
  return new Paragraph({
    children,
    spacing: { line: SINGLE_LINE },
    widowControl: true,
    ...options
  });
}

function textParagraph(text: string, options: Omit<IParagraphOptions, "children"> = {}): Paragraph {
  return sopParagraph([run(text)], options);
}

function emptyParagraph(): Paragraph {
  return sopParagraph([]);
}

function emptyParagraphs(count: number): Paragraph[] {
  return Array.from({ length: count }, () => emptyParagraph());
}

async function createBundledSeal(): Promise<ImageRun | null> {
  if (typeof window === "undefined") return null;
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}assets/seals/dod-seal.png`);
    if (!response.ok) return null;
    return new ImageRun({
      type: "png",
      data: new Uint8Array(await response.arrayBuffer()),
      transformation: {
        width: SEAL_SIZE,
        height: SEAL_SIZE
      },
      altText: {
        title: "Defense Health Agency seal",
        description: "Defense Health Agency seal",
        name: "Defense Health Agency seal"
      }
    });
  } catch {
    return null;
  }
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

function createFirstPageHeader(spec: SopSpec): Header {
  void spec;
  return new Header({ children: [emptyParagraph()] });
}

function createContinuationHeader(spec: SopSpec): Header {
  return new Header({
    children: [
      textParagraph(designation(spec, true)),
      textParagraph(`SUBJECT:  ${spec.subject.trim() || "[SUBJECT]"}`)
    ]
  });
}

function createContinuationFooter(): Footer {
  return new Footer({
    children: [
      sopParagraph([new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: FONT_SIZE_PT * 2 })], {
        alignment: AlignmentType.CENTER
      })
    ]
  });
}

async function createPublicationHeader(spec: SopSpec): Promise<Paragraph[]> {
  const subject = spec.subject.trim() || "[SUBJECT]";
  const seal = await createBundledSeal();
  return [
    ...(seal
      ? [
          sopParagraph([seal], {
            alignment: AlignmentType.CENTER,
            spacing: { line: SINGLE_LINE }
          })
        ]
      : []),
    textParagraph("Defense Health Agency", { alignment: AlignmentType.CENTER }),
    textParagraph("General Leonard Wood Community Hospital", { alignment: AlignmentType.CENTER }),
    emptyParagraph(),
    textParagraph(designation(spec), { alignment: AlignmentType.CENTER }),
    textParagraph(spec.date.trim() || "[DATE]", { alignment: AlignmentType.CENTER }),
    emptyParagraph(),
    textParagraph(spec.proponent.trim() || "[PROPONENT]"),
    textParagraph(`SUBJECT:  ${subject}`),
    textParagraph("References:  See Enclosure 1."),
    emptyParagraph()
  ];
}

function nodeText(node: ParagraphNode): ParagraphChild[] {
  const heading = node.heading?.trim();
  if (!heading) return [run(node.text.trim())];
  const suffix = node.text.trim() ? ".  " : "";
  return [run(`${heading}${suffix}`, { bold: true }), run(node.text.trim())];
}

function createNumberedNodes(nodes: ParagraphNode[], depth = 0): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  nodes.forEach((node, index) => {
    const label = `${sopLabel(depth, index + 1)}  `;
    paragraphs.push(
      sopParagraph([run(label), ...nodeText(node)], {
        indent: { left: 0, firstLine: depth * INDENT_STEP },
        keepLines: true,
        spacing: { line: SINGLE_LINE, after: PARAGRAPH_AFTER }
      })
    );
    paragraphs.push(...createNumberedNodes(node.children, depth + 1));
  });
  return paragraphs;
}

function createAboveSignatureSection(
  sectionNumber: number,
  title: string,
  nodes: ParagraphNode[]
): Paragraph[] {
  const visible = nonEmptyParagraphs(nodes);
  if (!visible.length) return [];
  const [first, ...rest] = visible;
  return [
    sopParagraph([run(`${sectionNumber}.  ${title}.  `, { bold: true }), ...nodeText(first)], {
      keepLines: true,
      spacing: { line: SINGLE_LINE, after: PARAGRAPH_AFTER }
    }),
    ...createNumberedNodes(first.children, 1),
    ...createNumberedNodes(rest, 1)
  ];
}

function createEffectiveDateSection(sectionNumber: number, spec: SopSpec): Paragraph[] {
  const kind = `This ${designation(spec, true)}`;
  const firstSentence = spec.sections.effectiveDate.effectiveOnSignature
    ? `${kind} is effective upon signature.`
    : `${kind} is effective on the date specified by the approval authority.`;
  const secondSentence = `It will expire ${spec.sections.effectiveDate.expiresYears} years from the date of signature if not reissued or canceled.`;
  return [
    sopParagraph([run(`${sectionNumber}.  EFFECTIVE DATE.  `, { bold: true }), run(`${firstSentence}  ${secondSentence}`)], {
      keepLines: true,
      spacing: { line: SINGLE_LINE, after: PARAGRAPH_AFTER }
    })
  ];
}

function createAboveSignatureSections(spec: SopSpec): Paragraph[] {
  const sections: Paragraph[] = [];
  let number = 1;
  const append = (title: string, nodes: ParagraphNode[] | null) => {
    const paragraphs = createAboveSignatureSection(number, title, nodes ?? []);
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
    sopParagraph([run(`${number}.  RELEASABILITY.  `, { bold: true }), run(releasabilityText(spec.sections.releasability))], {
      keepLines: true,
      spacing: { line: SINGLE_LINE, after: PARAGRAPH_AFTER }
    })
  );
  number += 1;
  sections.push(...createEffectiveDateSection(number, spec));
  number += 1;
  append("FORMS", spec.sections.forms);
  append("SUMMARY OF CHANGES", spec.sections.summaryOfChanges);
  return sections;
}

function createSignature(spec: SopSpec): Paragraph[] {
  return [
    ...emptyParagraphs(6),
    textParagraph(spec.signature.name.trim().toUpperCase(), {
      indent: { left: SIGNATURE_LEFT },
      keepNext: true
    }),
    textParagraph(spec.signature.rankBranch.trim(), {
      indent: { left: SIGNATURE_LEFT },
      keepNext: true
    }),
    ...spec.signature.title.map((title, index) =>
      textParagraph(title.trim(), {
        indent: { left: SIGNATURE_LEFT + (index === 0 ? 0 : INDENT_STEP) },
        keepNext: index < spec.signature.title.length - 1
      })
    )
  ];
}

function enclosureHeading(number: number, title: string, pageBreakBefore = true): Paragraph[] {
  return [
    textParagraph(`ENCLOSURE ${number}`, {
      alignment: AlignmentType.CENTER,
      pageBreakBefore,
      spacing: { line: SINGLE_LINE, after: PARAGRAPH_AFTER }
    }),
    textParagraph(title.toUpperCase(), {
      alignment: AlignmentType.CENTER,
      spacing: { line: SINGLE_LINE, after: PARAGRAPH_AFTER }
    }),
    emptyParagraph()
  ];
}

function createReferences(spec: SopSpec): Paragraph[] {
  const refs = spec.references.map((reference) => reference.trim()).filter(Boolean);
  return [
    ...enclosureHeading(1, "References"),
    ...refs.map((reference, index) =>
      sopParagraph([run(`(${String.fromCharCode(97 + index)})  ${reference}`)], {
        indent: { left: 518, hanging: 518 },
        spacing: { line: SINGLE_LINE, after: PARAGRAPH_AFTER }
      })
    )
  ];
}

function createResponsibilities(spec: SopSpec): Paragraph[] {
  return [
    ...enclosureHeading(2, "Responsibilities"),
    ...createNumberedNodes(nonEmptyParagraphs(spec.enclosures.responsibilities))
  ];
}

function createProcedures(spec: SopSpec): Paragraph[] {
  const paragraphs: Paragraph[] = [
    ...enclosureHeading(3, "Procedures"),
    ...createNumberedNodes(nonEmptyParagraphs(spec.enclosures.procedures))
  ];
  spec.enclosures.appendices.forEach((appendix, index) => {
    const title = spec.enclosures.appendices.length === 1
      ? `APPENDIX: ${appendix.title.toUpperCase()}`
      : `APPENDIX ${index + 1}: ${appendix.title.toUpperCase()}`;
    paragraphs.push(
      emptyParagraph(),
      textParagraph(title, {
        alignment: AlignmentType.CENTER,
        spacing: { line: SINGLE_LINE, after: PARAGRAPH_AFTER }
      }),
      ...createNumberedNodes(nonEmptyParagraphs(appendix.body))
    );
  });
  return paragraphs;
}

function createGlossary(spec: SopSpec): Paragraph[] {
  const acronyms = [...spec.glossary.acronyms]
    .filter((entry) => entry.term.trim() && entry.meaning.trim())
    .sort((a, b) => a.term.localeCompare(b.term));
  const definitions = [...spec.glossary.definitions]
    .filter((entry) => entry.term.trim() && entry.definition.trim())
    .sort((a, b) => a.term.localeCompare(b.term));
  if (!acronyms.length && !definitions.length) return [];

  const children: Paragraph[] = [
    textParagraph("GLOSSARY", {
      alignment: AlignmentType.CENTER,
      pageBreakBefore: true,
      spacing: { line: SINGLE_LINE, after: PARAGRAPH_AFTER }
    })
  ];
  if (acronyms.length) {
    children.push(
      textParagraph(definitions.length ? "PART I.  ABBREVIATIONS AND ACRONYMS" : "ABBREVIATIONS AND ACRONYMS", {
        spacing: { line: SINGLE_LINE, after: PARAGRAPH_AFTER }
      }),
      ...acronyms.map((entry) =>
        textParagraph(`${entry.term.trim()}\t${entry.meaning.trim()}`, {
          spacing: { line: SINGLE_LINE, after: PARAGRAPH_AFTER }
        })
      )
    );
  }
  if (definitions.length) {
    children.push(
      emptyParagraph(),
      textParagraph(acronyms.length ? "PART II.  DEFINITIONS" : "DEFINITIONS", {
        spacing: { line: SINGLE_LINE, after: PARAGRAPH_AFTER }
      }),
      ...definitions.map((entry) =>
        sopParagraph([run(`${entry.term.trim()}.  `, { bold: true }), run(entry.definition.trim())], {
          spacing: { line: SINGLE_LINE, after: PARAGRAPH_AFTER }
        })
      )
    );
  }
  return children;
}

function documentTypeDescription(documentType: DocumentType): string {
  return documentType === "regulation" ? "GLWCH Regulation" : "GLWCH Pamphlet";
}

export async function buildDocx(spec: SopSpec): Promise<Blob> {
  const validation = validateSop(spec);
  if (!validation.canGenerate) {
    throw new Error(
      `Cannot generate publication: ${validation.blockingErrors
        .map(({ label }) => label)
        .join(", ")}`
    );
  }

  const document = new Document({
    creator: "SOPWriter",
    title: spec.subject.trim() || documentTypeDescription(spec.documentType),
    description: "Local-first GLWCH publication generated in DHA format.",
    styles: {
      default: {
        document: {
          run: { font: FONT, size: FONT_SIZE_PT * 2 },
          paragraph: { spacing: { line: SINGLE_LINE } }
        }
      }
    },
    sections: [
      {
        properties: {
          titlePage: true,
          page: {
            size: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
            margin: {
              top: MARGIN,
              right: MARGIN,
              bottom: MARGIN,
              left: MARGIN,
              header: HEADER_FOOTER_MARGIN,
              footer: HEADER_FOOTER_MARGIN
            }
          }
        },
        headers: {
          first: createFirstPageHeader(spec),
          default: createContinuationHeader(spec)
        },
        footers: {
          first: new Footer({ children: [emptyParagraph()] }),
          default: createContinuationFooter()
        },
        children: [
          ...(await createPublicationHeader(spec)),
          ...createAboveSignatureSections(spec),
          ...createSignature(spec),
          ...createReferences(spec),
          ...createResponsibilities(spec),
          ...createProcedures(spec),
          ...createGlossary(spec)
        ] as FileChild[]
      }
    ]
  });

  return Packer.toBlob(document);
}
