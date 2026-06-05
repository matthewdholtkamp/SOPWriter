import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { applyAssistantPatch, appliedFieldsFromResponse } from "../src/assistant/apply";
import { requestSopAssistant } from "../src/assistant/client";
import type { AssistantMessage } from "../src/assistant/schema";
import { buildDocx } from "../src/generator/buildDocx";
import { createDefaultSpec } from "../src/model/defaultSpec";
import type { ParagraphNode, SopSpec } from "../src/model/sopSpec";
import { validateSop } from "../src/validation/validate";

const prompt =
  "Create a complete GLWCH Regulation from scratch for patient identification before care, treatment, and services. Use normal hospital expectations, no PHI, and leave unknown local facts as [TBD].";

const benchmark = {
  topic: "Patient Identification Before Care, Treatment, and Services",
  sources: [
    "Joint Commission National Performance Goals (NPGs), Hospital effective January 1, 2026",
    "Joint Commission NPG #1: Right Patient, Right Care",
    "Joint Commission FAQ: Two Patient Identifiers, last updated April 21, 2026",
    "DHA-AI 6025.16, Surgical and Procedural Patient Safety Program, incorporating Change 1"
  ],
  expectations: [
    "Uses current NPG framing for hospital patient identification rather than only legacy NPSG language.",
    "Requires at least two patient identifiers before providing care, treatment, and services.",
    "Does not allow room number or physical location as an identifier.",
    "Covers medication, blood/blood components, specimen collection, procedures, nutrition/special diets, noncommunicative patients, temporary identity, aliases, and newborns or explicitly marks local details as [TBD].",
    "Labels blood and specimen containers in the presence of the patient after identity verification.",
    "Assigns responsibilities to officials, not offices.",
    "Avoids PHI, patient examples, room numbers, phone numbers, and location-dependent workflows.",
    "Uses must/will/may/can and avoids shall.",
    "Uses GLWCH and General Leonard Wood Community Hospital, not GLWACH or General Leonard Wood Army Community Hospital."
  ]
};

function walk(nodes: ParagraphNode[], visit: (node: ParagraphNode) => void): void {
  nodes.forEach((node) => {
    visit(node);
    walk(node.children, visit);
  });
}

function allText(spec: SopSpec): string {
  const parts = [
    spec.documentType,
    spec.publicationNumber,
    spec.date,
    spec.proponent,
    spec.subject,
    ...spec.references,
    spec.signature.name,
    spec.signature.rankBranch,
    ...spec.signature.title
  ];
  const collections = [
    spec.sections.purpose,
    spec.sections.applicability,
    spec.sections.policyImplementation,
    spec.sections.canceledDocuments ?? [],
    spec.sections.responsibilitiesBrief,
    spec.sections.proceduresBrief,
    spec.sections.informationCollection ?? [],
    spec.sections.proponentAndWaivers,
    spec.sections.forms ?? [],
    spec.sections.summaryOfChanges ?? [],
    spec.enclosures.responsibilities,
    spec.enclosures.procedures,
    ...spec.enclosures.appendices.map((appendix) => appendix.body)
  ];
  collections.forEach((nodes) =>
    walk(nodes, (node) => {
      parts.push(node.heading ?? "", node.text);
    })
  );
  spec.glossary.acronyms.forEach((entry) => parts.push(entry.term, entry.meaning));
  spec.glossary.definitions.forEach((entry) => parts.push(entry.term, entry.definition));
  return parts.join("\n");
}

function includesAny(text: string, values: string[]): boolean {
  const lower = text.toLowerCase();
  return values.some((value) => lower.includes(value.toLowerCase()));
}

function scoreSpec(spec: SopSpec) {
  const text = allText(spec);
  const checks = [
    {
      id: "local-facts-placeholder",
      label: "Unknown local publication number and proponent remain placeholders",
      passed:
        /(?:\[NUMBER\]|\[TBD\]|___)/i.test(spec.publicationNumber || "[NUMBER]") &&
        /(?:\[TBD\]|___)/i.test(spec.proponent)
    },
    {
      id: "publication-number",
      label: "Publication number is bare and generator-safe",
      passed:
        !spec.publicationNumber.trim() ||
        /^\[NUMBER\]$|^\[TBD\]$|^\d{1,3}(?:-[A-Z0-9[\]TBD]+)+$/i.test(spec.publicationNumber.trim())
    },
    {
      id: "subject",
      label: "Subject clearly matches patient identification",
      passed: /patient identification|identify patients|right patient/i.test(spec.subject)
    },
    {
      id: "npg",
      label: "Uses current Joint Commission NPG framing",
      passed: /National Performance Goal|NPG|Right Patient, Right Care/i.test(text)
    },
    {
      id: "two-identifiers",
      label: "Requires at least two patient identifiers",
      passed: /two patient identifiers|two identifiers|at least two/i.test(text)
    },
    {
      id: "no-location-id",
      label: "Disallows room number or physical location as an identifier",
      passed: /room number|physical location|location as an identifier/i.test(text)
    },
    {
      id: "specimens",
      label: "Covers blood/specimen container labeling in patient presence",
      passed:
        includesAny(text, ["specimen", "blood"]) &&
        includesAny(text, ["presence of the patient", "in the presence"])
    },
    {
      id: "medications",
      label: "Covers medications or blood products",
      passed: includesAny(text, ["medication", "blood product", "blood component"])
    },
    {
      id: "procedures",
      label: "Covers procedures or procedural verification",
      passed: includesAny(text, ["procedure", "procedural", "time-out", "time out"])
    },
    {
      id: "noncommunicative",
      label: "Covers noncommunicative/confused patients or temporary identity",
      passed: includesAny(text, ["non-communicative", "noncommunicative", "confused", "temporary"])
    },
    {
      id: "newborn",
      label: "Covers newborn distinct identification or marks it [TBD]",
      passed: includesAny(text, ["newborn", "neonate", "[TBD]"])
    },
    {
      id: "no-shall",
      label: "Avoids shall",
      passed: !/\bshall\b/i.test(text)
    },
    {
      id: "no-old-name",
      label: "Uses GLWCH naming and avoids GLWACH",
      passed: !/GLWACH|General Leonard Wood Army Community Hospital/.test(text)
    },
    {
      id: "officials",
      label: "Responsibilities are assigned to officials rather than offices",
      passed: spec.enclosures.responsibilities.some((node) =>
        /Commander|Director|Chief|Officer|Manager|Supervisor|Leader|Proponent/i.test(
          `${node.heading ?? ""} ${node.text}`
        )
      )
    }
  ];
  return {
    passed: checks.filter((check) => check.passed).length,
    total: checks.length,
    checks
  };
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function main() {
  const startedAt = new Date();
  const runId = startedAt.toISOString().replace(/[:.]/g, "-");
  const outputDir = join(process.cwd(), "output", "stress-tests", runId);
  await mkdir(outputDir, { recursive: true });

  const baseSpec = createDefaultSpec();
  const messages: AssistantMessage[] = [
    {
      id: "stress-test-user",
      role: "user",
      text: prompt
    }
  ];

  await writeFile(join(outputDir, "prompt.txt"), `${prompt}\n`);
  await writeFile(join(outputDir, "benchmark.json"), json(benchmark));
  await writeFile(join(outputDir, "base-spec.json"), json(baseSpec));

  const baseValidation = validateSop(baseSpec);
  let assistantResponse: Awaited<ReturnType<typeof requestSopAssistant>>;
  let finalSpec = baseSpec;
  let docxGenerated = false;
  let docxError: string | null = null;

  try {
    assistantResponse = await requestSopAssistant({
      spec: baseSpec,
      messages,
      userText: prompt,
      validationItems: baseValidation.items
    });
  } catch (error) {
    const failure = {
      runId,
      prompt,
      error: error instanceof Error ? error.message : String(error)
    };
    await writeFile(join(outputDir, "assistant-error.json"), json(failure));
    console.log(json({ outputDir, failure }));
    process.exitCode = 1;
    return;
  }

  await writeFile(join(outputDir, "assistant-response.json"), json(assistantResponse));

  const appliedFields =
    assistantResponse.action === "applyPatch" && assistantResponse.specPatch
      ? appliedFieldsFromResponse(assistantResponse)
      : [];
  if (assistantResponse.action === "applyPatch" && assistantResponse.specPatch) {
    finalSpec = applyAssistantPatch(baseSpec, assistantResponse.specPatch);
  }

  const finalValidation = validateSop(finalSpec);
  const score = scoreSpec(finalSpec);

  if (finalValidation.canGenerate) {
    try {
      const blob = await buildDocx(finalSpec);
      await writeFile(
        join(outputDir, "patient-identification-stress-test.docx"),
        Buffer.from(await blob.arrayBuffer())
      );
      docxGenerated = true;
    } catch (error) {
      docxError = error instanceof Error ? error.message : String(error);
    }
  }

  const report = {
    runId,
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    outputDir,
    prompt,
    assistantAction: assistantResponse.action,
    appliedFields,
    assistantWarnings: assistantResponse.warnings,
    assistantQuestions: assistantResponse.questions,
    validation: {
      canGenerate: finalValidation.canGenerate,
      blockingErrors: finalValidation.blockingErrors,
      warnings: finalValidation.warnings
    },
    docxGenerated,
    docxError,
    score,
    summary: {
      subject: finalSpec.subject,
      documentType: finalSpec.documentType,
      publicationNumber: finalSpec.publicationNumber,
      date: finalSpec.date,
      proponent: finalSpec.proponent,
      references: finalSpec.references,
      responsibilitiesCount: finalSpec.enclosures.responsibilities.length,
      proceduresCount: finalSpec.enclosures.procedures.length,
      appendicesCount: finalSpec.enclosures.appendices.length,
      glossaryAcronyms: finalSpec.glossary.acronyms
    }
  };

  await writeFile(join(outputDir, "final-spec.json"), json(finalSpec));
  await writeFile(join(outputDir, "validation.json"), json(finalValidation));
  await writeFile(join(outputDir, "comparison-report.json"), json(report));
  await writeFile(
    join(outputDir, "comparison-report.md"),
    [
      "# Ask Dr. Holtkamp Scratch SOP Stress Test",
      "",
      `Run ID: ${runId}`,
      "",
      "## Prompt",
      "",
      prompt,
      "",
      "## Result",
      "",
      `- Assistant action: ${assistantResponse.action}`,
      `- Applied fields: ${appliedFields.join(", ") || "none"}`,
      `- Can generate DOCX: ${finalValidation.canGenerate ? "yes" : "no"}`,
      `- DOCX generated: ${docxGenerated ? "yes" : "no"}`,
      docxError ? `- DOCX error: ${docxError}` : "",
      `- Rubric score: ${score.passed}/${score.total}`,
      "",
      "## Validation Warnings",
      "",
      ...(finalValidation.warnings.length
        ? finalValidation.warnings.map((item) => `- ${item.label}: ${item.detail}`)
        : ["- None"]),
      "",
      "## Blocking Errors",
      "",
      ...(finalValidation.blockingErrors.length
        ? finalValidation.blockingErrors.map((item) => `- ${item.label}: ${item.detail}`)
        : ["- None"]),
      "",
      "## Rubric",
      "",
      ...score.checks.map((check) => `- ${check.passed ? "PASS" : "MISS"}: ${check.label}`),
      "",
      "## Assistant Message",
      "",
      assistantResponse.assistantMessage,
      "",
      "## Assistant Warnings",
      "",
      ...(assistantResponse.warnings.length
        ? assistantResponse.warnings.map((warning) => `- ${warning}`)
        : ["- None"]),
      "",
      "## Assistant Questions",
      "",
      ...(assistantResponse.questions.length
        ? assistantResponse.questions.map((question) => `- ${question}`)
        : ["- None"]),
      ""
    ]
      .filter((line) => line !== "")
      .join("\n")
  );

  console.log(json(report));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
