import { convertLegacyText } from "./mapLegacy";
import type { DocumentType } from "../model/sopSpec";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";

export function convertPastedLegacyText(text: string, documentType: DocumentType) {
  return convertLegacyText(text, documentType);
}

type PdfTextItem = { str: string; hasEOL?: boolean };

function isTextItem(item: unknown): item is PdfTextItem {
  return Boolean(item && typeof item === "object" && "str" in item);
}

function normalizeExtractedText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function extractDocxText(file: File): Promise<string> {
  const { strFromU8, unzipSync } = await import("fflate");
  const archive = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const documentXml = archive["word/document.xml"];
  if (!documentXml) {
    throw new Error("This .docx file did not contain readable document text.");
  }
  const xml = strFromU8(documentXml)
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<w:br\/>/g, "\n");
  const paragraphs = xml.match(/<w:p[\s\S]*?<\/w:p>/g) ?? [];
  const text = normalizeExtractedText(
    paragraphs
      .map((paragraph) =>
        [...paragraph.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
          .map((match) =>
            match[1]
              .replace(/&lt;/g, "<")
              .replace(/&gt;/g, ">")
              .replace(/&quot;/g, '"')
              .replace(/&apos;/g, "'")
              .replace(/&amp;/g, "&")
          )
          .join("")
      )
      .filter((paragraph) => paragraph.trim())
      .join("\n")
  );
  if (!text) {
    throw new Error("This .docx file did not contain readable text.");
  }
  return text;
}

async function extractPdfText(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer())
  });
  const pdfDocument = await loadingTask.promise;
  const pages: string[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
      const page = await pdfDocument.getPage(pageNumber);
      const content = await page.getTextContent();
      const lines: string[] = [];
      let line = "";

      content.items.forEach((item) => {
        if (!isTextItem(item)) return;
        line = `${line}${line ? " " : ""}${item.str}`;
        if (item.hasEOL) {
          lines.push(line.trimEnd());
          line = "";
        }
      });
      if (line.trim()) lines.push(line.trimEnd());
      pages.push(lines.join("\n").trim());
    }
  } finally {
    await loadingTask.destroy();
  }

  const text = normalizeExtractedText(pages.join("\n\n"));
  if (!text) {
    throw new Error("This PDF did not contain extractable text.");
  }
  return text;
}

export async function extractLegacyTextFromFile(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".docx")) return extractDocxText(file);
  if (name.endsWith(".txt") || file.type.startsWith("text/")) return normalizeExtractedText(await file.text());
  if (name.endsWith(".pdf") || file.type === "application/pdf") {
    try {
      return await extractPdfText(file);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Unknown PDF parsing error.";
      throw new Error(`PDF text could not be extracted. ${detail} You can still paste the PDF text into the converter.`);
    }
  }
  throw new Error("Use a PDF, .docx, or .txt file, or paste the policy text.");
}
