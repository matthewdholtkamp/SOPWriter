import { createDefaultSpec } from "../src/model/defaultSpec";
import type { SopSpec } from "../src/model/sopSpec";

export function createSyntheticSpec(overrides: Partial<SopSpec> = {}): SopSpec {
  return {
    ...createDefaultSpec(),
    subject: "Fall Prevention Program",
    publicationNumber: "40-43",
    date: "January 1, 2026",
    readiness: {
      formattingConverted: true,
      hospitalNameUpdated: true,
      acronymUpdated: true,
      proceduresReviewedForMove: true,
      affectedAreasReviewed: true,
      deputyLaneReviewed: true
    },
    ...overrides
  };
}
