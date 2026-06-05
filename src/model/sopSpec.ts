import { z } from "zod";

export const SPEC_VERSION = "1.0.0" as const;

export const appModeSchema = z.enum(["author", "convert"]);
export type AppMode = z.infer<typeof appModeSchema>;

export const documentTypeSchema = z.enum(["regulation", "pamphlet"]);
export type DocumentType = z.infer<typeof documentTypeSchema>;

export const releasabilitySchema = z.enum(["public", "notPublic"]);
export type Releasability = z.infer<typeof releasabilitySchema>;

export const approvalAuthoritySchema = z.enum(["commander", "deputy"]);
export type ApprovalAuthority = z.infer<typeof approvalAuthoritySchema>;

export type ParagraphNode = {
  heading?: string;
  text: string;
  children: ParagraphNode[];
};

export const paragraphNodeSchema: z.ZodType<ParagraphNode> = z.lazy(() =>
  z.object({
    heading: z.string().optional(),
    text: z.string(),
    children: z.array(paragraphNodeSchema)
  })
);

export const signatureSchema = z.object({
  name: z.string(),
  rankBranch: z.string(),
  title: z.array(z.string()).min(1),
  approvalAuthority: approvalAuthoritySchema
});
export type Signature = z.infer<typeof signatureSchema>;

export const effectiveDateSchema = z.object({
  effectiveOnSignature: z.boolean(),
  expiresYears: z.number().int().min(1).max(30)
});

export const sopSectionsSchema = z.object({
  purpose: z.array(paragraphNodeSchema),
  applicability: z.array(paragraphNodeSchema),
  policyImplementation: z.array(paragraphNodeSchema),
  canceledDocuments: z.array(paragraphNodeSchema).nullable(),
  responsibilitiesBrief: z.array(paragraphNodeSchema),
  proceduresBrief: z.array(paragraphNodeSchema),
  informationCollection: z.array(paragraphNodeSchema).nullable(),
  proponentAndWaivers: z.array(paragraphNodeSchema),
  releasability: releasabilitySchema,
  effectiveDate: effectiveDateSchema,
  forms: z.array(paragraphNodeSchema).nullable(),
  summaryOfChanges: z.array(paragraphNodeSchema).nullable()
});
export type SopSections = z.infer<typeof sopSectionsSchema>;

export const appendixSchema = z.object({
  title: z.string(),
  body: z.array(paragraphNodeSchema)
});
export type Appendix = z.infer<typeof appendixSchema>;

export const sopEnclosuresSchema = z.object({
  responsibilities: z.array(paragraphNodeSchema),
  procedures: z.array(paragraphNodeSchema),
  appendices: z.array(appendixSchema)
});
export type SopEnclosures = z.infer<typeof sopEnclosuresSchema>;

export const glossarySchema = z.object({
  acronyms: z.array(
    z.object({
      term: z.string(),
      meaning: z.string()
    })
  ),
  definitions: z.array(
    z.object({
      term: z.string(),
      definition: z.string()
    })
  )
});
export type Glossary = z.infer<typeof glossarySchema>;

export const legacySchema = z.object({
  sourceDesignation: z.string(),
  sourceTitle: z.string(),
  sourceDate: z.string(),
  ingestedText: z.string()
});
export type LegacyInfo = z.infer<typeof legacySchema>;

export const readinessSchema = z.object({
  formattingConverted: z.boolean(),
  hospitalNameUpdated: z.boolean(),
  acronymUpdated: z.boolean(),
  proceduresReviewedForMove: z.boolean(),
  affectedAreasReviewed: z.boolean(),
  deputyLaneReviewed: z.boolean()
});
export type Readiness = z.infer<typeof readinessSchema>;

export const sopSpecSchema = z.object({
  specVersion: z.literal(SPEC_VERSION),
  mode: appModeSchema,
  documentType: documentTypeSchema,
  profileId: z.string(),
  publicationNumber: z.string(),
  date: z.string(),
  proponent: z.string(),
  subject: z.string(),
  references: z.array(z.string()),
  sections: sopSectionsSchema,
  signature: signatureSchema,
  enclosures: sopEnclosuresSchema,
  glossary: glossarySchema,
  tables: z.array(z.object({ number: z.number().int().positive(), title: z.string() })),
  figures: z.array(z.object({ number: z.number().int().positive(), title: z.string() })),
  legacy: legacySchema.nullable(),
  readiness: readinessSchema
});
export type SopSpec = z.infer<typeof sopSpecSchema>;

export function cloneSpec(spec: SopSpec): SopSpec {
  return structuredClone(spec);
}

export function emptyParagraph(text = ""): ParagraphNode {
  return { text, children: [] };
}

export function nonEmptyParagraphs(nodes: ParagraphNode[] | null | undefined): ParagraphNode[] {
  return (nodes ?? []).filter(
    (node) => node.text.trim() || node.heading?.trim() || node.children.length > 0
  );
}
