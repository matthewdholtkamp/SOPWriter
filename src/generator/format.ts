export const DXA_PER_INCH = 1440;
export const PAGE_WIDTH = 12240;
export const PAGE_HEIGHT = 15840;
export const MARGIN = DXA_PER_INCH;
export const HEADER_FOOTER_MARGIN = 720;
export const CONTENT_WIDTH = 9360;
export const INDENT_STEP = 360;
export const SIGNATURE_LEFT = 4680;
export const SINGLE_LINE = 240;
export const PARAGRAPH_AFTER = 200;
export const MAX_SUBLEVEL_DEPTH = 5;

export function sopLabel(depth: number, ordinal: number): string {
  const letter = String.fromCharCode(96 + Math.min(ordinal, 26));
  switch (depth) {
    case 0:
      return `${ordinal}.`;
    case 1:
      return `${letter}.`;
    case 2:
      return `(${ordinal})`;
    case 3:
      return `(${letter})`;
    case 4:
      return `${ordinal}.`;
    default:
      return `${letter}.`;
  }
}

export function publicationKindLabel(documentType: "regulation" | "pamphlet"): string {
  return documentType === "regulation" ? "Regulation" : "Pamphlet";
}

export function publicationShortLabel(documentType: "regulation" | "pamphlet"): string {
  return documentType === "regulation" ? "Reg" : "Pam";
}
