import { z } from "zod";
import {
  approvalAuthoritySchema,
  documentTypeSchema,
  effectiveDateSchema,
  glossarySchema,
  legacySchema,
  paragraphNodeSchema,
  readinessSchema,
  releasabilitySchema,
  signatureSchema
} from "../model/sopSpec";

export const ASSISTANT_WORKER_URL = "https://bandaid6.mholtkamp.workers.dev";
export const ASSISTANT_MODEL = "gemini-3.5-flash-lite";
export const ASSISTANT_FALLBACK_MODEL = "gemini-3.7-flash";

const sectionsPatchSchema = z
  .object({
    purpose: z.array(paragraphNodeSchema).optional(),
    applicability: z.array(paragraphNodeSchema).optional(),
    policyImplementation: z.array(paragraphNodeSchema).optional(),
    canceledDocuments: z.array(paragraphNodeSchema).nullable().optional(),
    responsibilitiesBrief: z.array(paragraphNodeSchema).optional(),
    proceduresBrief: z.array(paragraphNodeSchema).optional(),
    informationCollection: z.array(paragraphNodeSchema).nullable().optional(),
    proponentAndWaivers: z.array(paragraphNodeSchema).optional(),
    releasability: releasabilitySchema.optional(),
    effectiveDate: effectiveDateSchema.partial().optional(),
    forms: z.array(paragraphNodeSchema).nullable().optional(),
    summaryOfChanges: z.array(paragraphNodeSchema).nullable().optional()
  })
  .strict();

const enclosuresPatchSchema = z
  .object({
    responsibilities: z.array(paragraphNodeSchema).optional(),
    procedures: z.array(paragraphNodeSchema).optional(),
    appendices: z
      .array(
        z.object({
          title: z.string(),
          body: z.array(paragraphNodeSchema)
        })
      )
      .optional()
  })
  .strict();

export const assistantPatchSchema = z
  .object({
    mode: z.enum(["author", "convert"]).optional(),
    documentType: documentTypeSchema.optional(),
    publicationNumber: z.string().optional(),
    date: z.string().optional(),
    proponent: z.string().optional(),
    subject: z.string().optional(),
    references: z.array(z.string()).optional(),
    sections: sectionsPatchSchema.optional(),
    signature: signatureSchema
      .partial()
      .extend({ approvalAuthority: approvalAuthoritySchema.optional() })
      .optional(),
    enclosures: enclosuresPatchSchema.optional(),
    glossary: glossarySchema.partial().optional(),
    legacy: legacySchema.nullable().optional(),
    readiness: readinessSchema.partial().optional()
  })
  .strict();

export type AssistantPatch = z.infer<typeof assistantPatchSchema>;

export const assistantResponseSchema = z
  .object({
    assistantMessage: z.string(),
    action: z.enum(["applyPatch", "askClarifyingQuestion", "noChange"]),
    specPatch: assistantPatchSchema.nullable().optional(),
    changedFields: z
      .array(
        z.object({
          field: z.string(),
          reason: z.string().optional()
        })
      )
      .default([]),
    warnings: z.array(z.string()).default([]),
    questions: z.array(z.string()).default([])
  })
  .strict();

export type AssistantResponse = z.infer<typeof assistantResponseSchema>;

export type AssistantMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  appliedFields?: string[];
  warnings?: string[];
  questions?: string[];
};
