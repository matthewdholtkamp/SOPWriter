import { convertLegacyText } from "./mapLegacy";
import type { DocumentType } from "../model/sopSpec";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";

export function convertPastedLegacyText(text: string, documentType: DocumentType) {
  return convertLegacyText(text, documentType);
}

type MammothApi = typeof import("mammoth");
type MammothInput = Parameters<MammothApi["extractRawText"]>[0];
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
  const mammothModule = (await import("mammoth")) as unknown as MammothApi & {
    default?: MammothApi;
  };
  const mammoth = mammothModule.default ?? mammothModule;
  const arrayBuffer = await file.arrayBuffer();
  const runtime = globalThis as typeof globalThis & {
    Buffer?: { from: (value: ArrayBuffer) => unknown };
    process?: { versions?: { node?: string } };
  };
  const input =
    runtime.process?.versions?.node && runtime.Buffer
      ? ({ buffer: runtime.Buffer.from(arrayBuffer) } as MammothInput)
      : ({ arrayBuffer } as MammothInput);
  const result = await mammoth.extractRawText(input);
  const text = normalizeExtractedText(result.value);
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
