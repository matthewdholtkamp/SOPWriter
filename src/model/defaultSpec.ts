import { SPEC_VERSION, emptyParagraph, type SopSpec } from "./sopSpec";

export function createDefaultSpec(): SopSpec {
  return {
    specVersion: SPEC_VERSION,
    mode: "author",
    documentType: "regulation",
    profileId: "glwch",
    publicationNumber: "",
    date: "[DATE]",
    proponent: "Department of ___ (DCN ___)",
    subject: "",
    references: [
      'DoD Directive 5136.13, "Defense Health Agency (DHA)," September 30, 2013, as amended',
      'DHA-Procedural Instruction 5025.01, "Publication System," April 1, 2022'
    ],
    sections: {
      purpose: [
        emptyParagraph(
          "This GLWCH publication establishes local procedures for the subject identified above."
        )
      ],
      applicability: [
        emptyParagraph(
          "This publication applies to General Leonard Wood Community Hospital, outlying clinics, and assigned or attached personnel."
        )
      ],
      policyImplementation: [
        emptyParagraph(
          "This publication implements applicable Department of Defense, Defense Health Agency, and Service policy and establishes local procedures."
        )
      ],
      canceledDocuments: null,
      responsibilitiesBrief: [
        emptyParagraph(
          "This section summarizes responsibilities. Detailed responsibilities are in Enclosure 2."
        )
      ],
      proceduresBrief: [
        emptyParagraph(
          "This section summarizes procedures. Detailed procedures are in Enclosure 3."
        )
      ],
      informationCollection: null,
      proponentAndWaivers: [
        emptyParagraph(
          "The proponent of this publication is the responsible GLWCH department or directorate. Waiver requests will route through the hospital chain of command to the approval authority."
        )
      ],
      releasability: "notPublic",
      effectiveDate: { effectiveOnSignature: true, expiresYears: 10 },
      forms: null,
      summaryOfChanges: null
    },
    signature: {
      name: "Matthew D. Holtkamp",
      rankBranch: "COL, MC",
      title: ["Deputy Commander for Clinical Services"],
      approvalAuthority: "deputy"
    },
    enclosures: {
      responsibilities: [
        {
          heading: "Deputy Commander for Clinical Services",
          text: "The Deputy Commander for Clinical Services will ensure assigned clinical leaders review and implement this publication.",
          children: []
        },
        {
          heading: "Proponent",
          text: "The proponent will maintain this publication and coordinate required updates.",
          children: []
        }
      ],
      procedures: [
        {
          heading: "General",
          text: "The proponent will describe the local procedure steps in this enclosure.",
          children: []
        },
        {
          heading: "Review",
          text: "The proponent will review procedures for operational changes caused by the move to the new hospital.",
          children: []
        }
      ],
      appendices: []
    },
    glossary: { acronyms: [{ term: "GLWCH", meaning: "General Leonard Wood Community Hospital" }], definitions: [] },
    tables: [],
    figures: [],
    legacy: null,
    readiness: {
      formattingConverted: false,
      hospitalNameUpdated: false,
      acronymUpdated: false,
      proceduresReviewedForMove: false,
      affectedAreasReviewed: false,
      deputyLaneReviewed: false
    }
  };
}
