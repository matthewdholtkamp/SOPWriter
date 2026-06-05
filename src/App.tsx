import { useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties } from "react";
import { convertPastedLegacyText, extractLegacyTextFromFile } from "./convert/ingest";
import type { AssistantMessage } from "./assistant/schema";
import {
  blockLabel,
  blocksToParagraphs,
  ensureBlocks,
  normalizeBlockDepths,
  type EditorBlock
} from "./model/blocks";
import { createDefaultSpec } from "./model/defaultSpec";
import {
  clearActiveDraft,
  exportDraft,
  importDraft,
  restoreActiveDraft,
  saveActiveDraft
} from "./model/drafts";
import { approvalAuthorityLabel, builtInProfiles } from "./model/profiles";
import type { DocumentType, ParagraphNode, SopSpec } from "./model/sopSpec";
import {
  fixSentenceSpacing,
  validateSop,
  type ComplianceItem,
  type SopStage
} from "./validation/validate";
import { AskDrHoltkampPanel } from "./ui/AskDrHoltkampPanel";
import { CompliancePanel } from "./ui/CompliancePanel";
import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  PlusIcon,
  TrashIcon
} from "./ui/icons";
import { SopStageStrip } from "./ui/SopStageStrip";
import { StructuralPreview } from "./ui/StructuralPreview";

const STAGE_TARGETS: Record<SopStage, string> = {
  identity: "identity-stage",
  sections: "sections-editor",
  enclosures: "enclosures-editor",
  readiness: "readiness-panel",
  review: "review-stage"
};

const SECTION_LABELS: Array<{
  key:
    | "purpose"
    | "applicability"
    | "policyImplementation"
    | "canceledDocuments"
    | "responsibilitiesBrief"
    | "proceduresBrief"
    | "informationCollection"
    | "proponentAndWaivers"
    | "forms"
    | "summaryOfChanges";
  label: string;
  optional?: boolean;
}> = [
  { key: "purpose", label: "Purpose" },
  { key: "applicability", label: "Applicability" },
  { key: "policyImplementation", label: "Policy Implementation" },
  { key: "canceledDocuments", label: "Canceled Documents", optional: true },
  { key: "responsibilitiesBrief", label: "Responsibilities" },
  { key: "proceduresBrief", label: "Procedures" },
  { key: "informationCollection", label: "Information Collection", optional: true },
  { key: "proponentAndWaivers", label: "Proponent and Waivers" },
  { key: "forms", label: "Forms", optional: true },
  { key: "summaryOfChanges", label: "Summary of Changes", optional: true }
];

function downloadText(text: string, filename: string): void {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function readTextFile(file: File): Promise<string> {
  return file.text();
}

function StringListEditor({
  id,
  label,
  values,
  onChange,
  placeholder
}: {
  id?: string;
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
}) {
  return (
    <div className="field-group" id={id} tabIndex={id ? -1 : undefined}>
      <div className="list-label-row">
        <span className="field-label">{label}</span>
        <button
          className="text-button"
          onClick={() => onChange([...values, ""])}
          type="button"
        >
          <PlusIcon /> Add
        </button>
      </div>
      {values.length === 0 && <span className="empty-field-hint">None added</span>}
      {values.map((value, index) => (
        <div className="inline-field-row" key={`${label}-${index}`}>
          <input
            aria-label={`${label} ${index + 1}`}
            onChange={(event) =>
              onChange(values.map((entry, entryIndex) => (entryIndex === index ? event.target.value : entry)))
            }
            placeholder={placeholder}
            value={value}
          />
          <button
            aria-label={`Remove ${label} ${index + 1}`}
            className="icon-button"
            onClick={() => onChange(values.filter((_, entryIndex) => entryIndex !== index))}
            type="button"
          >
            <TrashIcon />
          </button>
        </div>
      ))}
    </div>
  );
}

function BlockEditor({
  ariaLabel,
  nodes,
  onChange
}: {
  ariaLabel: string;
  nodes: ParagraphNode[];
  onChange: (nodes: ParagraphNode[]) => void;
}) {
  const [blocks, setBlocks] = useState<EditorBlock[]>(() => ensureBlocks(nodes));

  const applyBlocks = (nextBlocks: EditorBlock[]) => {
    const normalized = normalizeBlockDepths(nextBlocks);
    setBlocks(normalized);
    onChange(blocksToParagraphs(normalized));
  };
  const updateBlock = (id: string, update: Partial<EditorBlock>) => {
    applyBlocks(blocks.map((block) => (block.id === id ? { ...block, ...update } : block)));
  };
  const moveBlock = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= blocks.length) return;
    const next = [...blocks];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    applyBlocks(next);
  };
  const deleteBlock = (index: number) => {
    const next = blocks.filter((_, entryIndex) => entryIndex !== index);
    applyBlocks(next.length ? next : [{ id: crypto.randomUUID(), depth: 0, heading: "", text: "" }]);
  };
  const addAfter = (index: number, depth: number) => {
    const next = [...blocks];
    next.splice(index + 1, 0, { id: crypto.randomUUID(), depth, heading: "", text: "" });
    applyBlocks(next);
  };

  return (
    <div aria-label={ariaLabel} className="block-list">
      {blocks.map((block, index) => (
        <div
          className="sop-block"
          key={block.id}
          style={{ "--block-depth": block.depth } as CSSProperties}
        >
          <span className="block-number">{blockLabel(blocks, index)}</span>
          <div className="block-fields">
            <input
              aria-label={`${ariaLabel} paragraph ${index + 1} heading`}
              onChange={(event) => updateBlock(block.id, { heading: event.target.value })}
              placeholder="Optional paragraph heading"
              value={block.heading ?? ""}
            />
            <textarea
              aria-label={`${ariaLabel} paragraph ${index + 1} text`}
              onChange={(event) => updateBlock(block.id, { text: event.target.value })}
              placeholder="Type paragraph text. Numbering is added automatically."
              rows={3}
              value={block.text}
            />
          </div>
          <div className="block-actions">
            <button
              aria-label={`Outdent paragraph ${index + 1}`}
              className="icon-button"
              disabled={block.depth === 0}
              onClick={() => updateBlock(block.id, { depth: Math.max(0, block.depth - 1) })}
              title="Outdent"
              type="button"
            >
              <ArrowLeftIcon />
            </button>
            <button
              aria-label={`Indent paragraph ${index + 1}`}
              className="icon-button"
              disabled={index === 0 || block.depth >= Math.min(5, blocks[index - 1].depth + 1)}
              onClick={() => updateBlock(block.id, { depth: block.depth + 1 })}
              title="Indent"
              type="button"
            >
              <ArrowRightIcon />
            </button>
            <button
              aria-label={`Move paragraph ${index + 1} up`}
              className="icon-button"
              disabled={index === 0}
              onClick={() => moveBlock(index, -1)}
              title="Move up"
              type="button"
            >
              <ArrowUpIcon />
            </button>
            <button
              aria-label={`Move paragraph ${index + 1} down`}
              className="icon-button"
              disabled={index === blocks.length - 1}
              onClick={() => moveBlock(index, 1)}
              title="Move down"
              type="button"
            >
              <ArrowDownIcon />
            </button>
            <button
              aria-label={`Delete paragraph ${index + 1}`}
              className="icon-button"
              onClick={() => deleteBlock(index)}
              title="Delete"
              type="button"
            >
              <TrashIcon />
            </button>
          </div>
          <div className="block-add-actions">
            <button className="text-button" onClick={() => addAfter(index, block.depth)} type="button">
              Add paragraph
            </button>
            <button className="text-button" onClick={() => addAfter(index, Math.min(5, block.depth + 1))} type="button">
              Add subparagraph
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function SectionEditor({
  label,
  nodes,
  onChange,
  optional
}: {
  label: string;
  nodes: ParagraphNode[] | null;
  onChange: (nodes: ParagraphNode[] | null) => void;
  optional?: boolean;
}) {
  const enabled = nodes !== null;
  return (
    <section className="editor-surface">
      <div className="section-heading-row">
        <div>
          <h3>{label}</h3>
          {optional && <p className="helper-text">Optional; omit to renumber automatically.</p>}
        </div>
        {optional && (
          <label className="switch-control">
            <input
              checked={enabled}
              onChange={(event) => onChange(event.target.checked ? [{ text: "", children: [] }] : null)}
              type="checkbox"
            />
            Include
          </label>
        )}
      </div>
      {enabled && (
        <BlockEditor
          ariaLabel={label}
          nodes={nodes ?? []}
          onChange={(nextNodes) => onChange(nextNodes)}
        />
      )}
    </section>
  );
}

function GlossaryEditor({
  spec,
  setSpec
}: {
  spec: SopSpec;
  setSpec: (spec: SopSpec) => void;
}) {
  return (
    <section className="editor-surface">
      <div className="section-heading-row">
        <h3>Glossary</h3>
      </div>
      <StringListEditor
        label="Acronyms"
        onChange={(values) =>
          setSpec({
            ...spec,
            glossary: {
              ...spec.glossary,
              acronyms: values.map((value) => {
                const [term = "", meaning = ""] = value.split(/\s+-\s+/, 2);
                return { term, meaning };
              })
            }
          })
        }
        placeholder="MTF - military medical treatment facility"
        values={spec.glossary.acronyms.map((entry) => `${entry.term} - ${entry.meaning}`)}
      />
      <StringListEditor
        label="Definitions"
        onChange={(values) =>
          setSpec({
            ...spec,
            glossary: {
              ...spec.glossary,
              definitions: values.map((value) => {
                const [term = "", definition = ""] = value.split(/\s+-\s+/, 2);
                return { term, definition };
              })
            }
          })
        }
        placeholder="term - definition"
        values={spec.glossary.definitions.map((entry) => `${entry.term} - ${entry.definition}`)}
      />
    </section>
  );
}

function AppendicesEditor({
  spec,
  setSpec
}: {
  spec: SopSpec;
  setSpec: (spec: SopSpec) => void;
}) {
  const appendices = spec.enclosures.appendices;
  const setAppendices = (nextAppendices: SopSpec["enclosures"]["appendices"]) => {
    setSpec({
      ...spec,
      enclosures: {
        ...spec.enclosures,
        appendices: nextAppendices
      }
    });
  };

  return (
    <section className="editor-surface">
      <div className="section-heading-row">
        <div>
          <h3>Appendices</h3>
          <p className="helper-text">Appendices render under Enclosure 3 in order.</p>
        </div>
        <button
          className="text-button"
          onClick={() =>
            setAppendices([
              ...appendices,
              { title: "Appendix Title", body: [{ text: "Enter appendix content.", children: [] }] }
            ])
          }
          type="button"
        >
          <PlusIcon /> Add appendix
        </button>
      </div>
      {appendices.length === 0 && <p className="empty-field-hint">No appendices added.</p>}
      {appendices.map((appendix, index) => (
        <div className="appendix-editor" key={`${appendix.title}-${index}`}>
          <div className="inline-field-row">
            <input
              aria-label={`Appendix ${index + 1} title`}
              onChange={(event) =>
                setAppendices(
                  appendices.map((entry, entryIndex) =>
                    entryIndex === index ? { ...entry, title: event.target.value } : entry
                  )
                )
              }
              placeholder="Appendix title"
              value={appendix.title}
            />
            <button
              aria-label={`Remove appendix ${index + 1}`}
              className="icon-button"
              onClick={() => setAppendices(appendices.filter((_, entryIndex) => entryIndex !== index))}
              type="button"
            >
              <TrashIcon />
            </button>
          </div>
          <BlockEditor
            ariaLabel={`Appendix ${index + 1}`}
            nodes={appendix.body}
            onChange={(body) =>
              setAppendices(
                appendices.map((entry, entryIndex) =>
                  entryIndex === index ? { ...entry, body } : entry
                )
              )
            }
          />
        </div>
      ))}
    </section>
  );
}

function ConvertPanel({
  documentType,
  onConverted
}: {
  documentType: DocumentType;
  onConverted: (spec: SopSpec, message: string) => void;
}) {
  const [legacyText, setLegacyText] = useState("");
  const [fileFeedback, setFileFeedback] = useState("");
  const [isReadingFile, setReadingFile] = useState(false);

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setReadingFile(true);
    setFileFeedback("");
    try {
      const text = await extractLegacyTextFromFile(file);
      setLegacyText(text);
      setFileFeedback(`Loaded text from ${file.name}.`);
    } catch (error) {
      setFileFeedback(error instanceof Error ? error.message : "Could not read that file.");
    } finally {
      setReadingFile(false);
      event.target.value = "";
    }
  };

  return (
    <section aria-labelledby="convert-title" className="editor-surface convert-surface">
      <div className="section-heading-row">
        <div>
          <h2 id="convert-title">Convert legacy text</h2>
          <p className="helper-text">Paste text from an old MEDDAC Pam/Reg or load a .docx/.txt file. Files stay on this device.</p>
        </div>
      </div>
      <label className="field">
        <span className="field-label">Legacy file</span>
        <input
          accept=".docx,.txt,.pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf"
          disabled={isReadingFile}
          onChange={handleFile}
          type="file"
        />
      </label>
      {fileFeedback && <p className="helper-text">{fileFeedback}</p>}
      <textarea
        aria-label="Legacy MEDDAC text"
        onChange={(event) => setLegacyText(event.target.value)}
        placeholder="Paste legacy policy text here..."
        rows={8}
        value={legacyText}
      />
      <button
        className="primary-button"
        disabled={!legacyText.trim()}
        onClick={() => {
          const result = convertPastedLegacyText(legacyText, documentType);
          onConverted(
            result.spec,
            [...result.changes, ...result.warnings, ...result.questions].join(" ")
          );
        }}
        type="button"
      >
        Map into SOP
      </button>
    </section>
  );
}

function ReadinessPanel({
  spec,
  setSpec
}: {
  spec: SopSpec;
  setSpec: (spec: SopSpec) => void;
}) {
  const update = (key: keyof SopSpec["readiness"], value: boolean) => {
    setSpec({ ...spec, readiness: { ...spec.readiness, [key]: value } });
  };
  const routing =
    spec.signature.approvalAuthority === "deputy"
      ? "Deputy signature: OICs/Civilians-in-charge of affected areas, then Executive Officer."
      : "Commander signature: OICs/Civilians-in-charge, corresponding Deputy lane, then Executive Officer.";
  const items: Array<[keyof SopSpec["readiness"], string]> = [
    ["formattingConverted", "Formatting converted to the new approved format"],
    ["hospitalNameUpdated", "General Leonard Wood Army Community Hospital changed to General Leonard Wood Community Hospital"],
    ["acronymUpdated", "GLWACH changed to GLWCH"],
    ["proceduresReviewedForMove", "Procedures reviewed for new hospital layout, locations, and workflow"],
    ["affectedAreasReviewed", "Affected area review complete"],
    ["deputyLaneReviewed", "Deputy lane review complete when Commander signature is required"]
  ];

  return (
    <section aria-labelledby="readiness-title" className="panel-section" id="readiness-panel" tabIndex={-1}>
      <div className="section-heading-row">
        <h2 id="readiness-title">Readiness</h2>
      </div>
      <p className="routing-note">{routing}</p>
      <div className="check-list">
        {items.map(([key, label]) => (
          <label className="check-row" key={key}>
            <input
              checked={spec.readiness[key]}
              onChange={(event) => update(key, event.target.checked)}
              type="checkbox"
            />
            <span>{label}</span>
          </label>
        ))}
      </div>
    </section>
  );
}

export default function App() {
  const restored = useMemo(() => restoreActiveDraft(), []);
  const [spec, setSpecState] = useState<SopSpec>(() => restored ?? createDefaultSpec());
  const [feedback, setFeedback] = useState("Ready.");
  const [activeStage, setActiveStage] = useState<SopStage>("identity");
  const [isAssistantOpen, setAssistantOpen] = useState(false);
  const [assistantMessages, setAssistantMessages] = useState<AssistantMessage[]>([]);
  const [assistantUndoSpec, setAssistantUndoSpec] = useState<SopSpec | null>(null);
  const [editorVersion, setEditorVersion] = useState(0);
  const [spacingProposal, setSpacingProposal] = useState<SopSpec | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const validation = useMemo(() => validateSop(spec), [spec]);

  const setSpec = (nextSpec: SopSpec) => {
    setSpecState(nextSpec);
    saveActiveDraft(nextSpec);
  };

  const loadSpec = (nextSpec: SopSpec, message: string) => {
    setSpec(nextSpec);
    setEditorVersion((version) => version + 1);
    setFeedback(message);
  };

  useEffect(() => {
    saveActiveDraft(spec);
  }, [spec]);

  const navigateToStage = (stage: SopStage, focusTarget = STAGE_TARGETS[stage]) => {
    setActiveStage(stage);
    window.requestAnimationFrame(() => {
      document.getElementById(focusTarget)?.focus();
    });
  };

  const onComplianceNavigate = (item: ComplianceItem) => {
    navigateToStage(item.stage, item.focusTarget ?? STAGE_TARGETS[item.stage]);
  };

  const handleDownload = async () => {
    setFeedback("Preparing the Word publication...");
    try {
      const { downloadDocx } = await import("./generator/download");
      await downloadDocx(spec);
      setFeedback("Downloaded the GLWCH publication.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Could not generate the document.");
    }
  };

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const imported = importDraft(await readTextFile(file));
      loadSpec(imported, "Loaded SOPWriter draft JSON.");
    } catch {
      setFeedback("That file is not a valid SOPWriter draft JSON export.");
    } finally {
      event.target.value = "";
    }
  };

  const applyAssistantSpec = (nextSpec: SopSpec, fields: string[]) => {
    setAssistantUndoSpec(spec);
    loadSpec(
      nextSpec,
      fields.length
        ? `Dr. Holtkamp updated: ${fields.join(", ")}.`
        : "Dr. Holtkamp updated the SOP."
    );
  };

  const undoAssistant = () => {
    if (!assistantUndoSpec) return;
    loadSpec(assistantUndoSpec, "Undid the most recent Dr. Holtkamp update.");
    setAssistantUndoSpec(null);
  };

  const updateSections = (
    key: keyof typeof spec.sections,
    value: (typeof spec.sections)[keyof typeof spec.sections]
  ) => {
    setSpec({ ...spec, sections: { ...spec.sections, [key]: value } });
  };

  return (
    <div className="app-shell">
      <header className="top-bar">
        <div className="brand-lockup">
          <span className="brand-mark">SW</span>
          <span className="brand-name">SOP Writer</span>
        </div>
        <div className="top-actions">
          <button
            aria-label="Ask Dr. Holtkamp SOP assistant"
            className="secondary-button"
            onClick={() => setAssistantOpen(true)}
            type="button"
          >
            Ask Dr. Holtkamp
          </button>
          <button
            className="secondary-button"
            onClick={() => loadSpec(createDefaultSpec(), "Started a new SOP.")}
            type="button"
          >
            New SOP
          </button>
          <button
            className="primary-button"
            disabled={!validation.canGenerate}
            onClick={handleDownload}
            type="button"
          >
            Generate .docx
          </button>
        </div>
      </header>

      <div className="privacy-banner">
        <strong>Local-first.</strong> Drafts stay in this browser. The only runtime network call is the optional assistant message you send.
      </div>

      <SopStageStrip activeStage={activeStage} onSelect={navigateToStage} validation={validation} />

      <main className="workspace" key={editorVersion}>
        <section aria-label="SOP editor" className="editor-column">
          <section aria-labelledby="identity-title" className="editor-surface" id="identity-stage" tabIndex={-1}>
            <div className="section-heading-row">
              <div>
                <p className="section-kicker">Publication identity</p>
                <h1 id="identity-title">GLWCH publication</h1>
              </div>
              <div className="segmented-control" role="group" aria-label="Mode">
                {(["author", "convert"] as const).map((mode) => (
                  <button
                    aria-pressed={spec.mode === mode}
                    className={spec.mode === mode ? "selected" : ""}
                    key={mode}
                    onClick={() => setSpec({ ...spec, mode })}
                    type="button"
                  >
                    {mode === "author" ? "Author" : "Convert"}
                  </button>
                ))}
              </div>
            </div>
            <div className="form-grid">
              <label className="field">
                <span className="field-label">Document type</span>
                <select
                  value={spec.documentType}
                  onChange={(event) => setSpec({ ...spec, documentType: event.target.value as DocumentType })}
                >
                  <option value="regulation">GLWCH Regulation</option>
                  <option value="pamphlet">GLWCH Pamphlet</option>
                </select>
              </label>
              <label className="field">
                <span className="field-label">Profile</span>
                <select
                  value={spec.profileId}
                  onChange={(event) => setSpec({ ...spec, profileId: event.target.value })}
                >
                  {builtInProfiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>{profile.displayName}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field-label">Publication number</span>
                <input
                  onChange={(event) => setSpec({ ...spec, publicationNumber: event.target.value })}
                  placeholder="40-43"
                  value={spec.publicationNumber}
                />
              </label>
              <label className="field">
                <span className="field-label">Date</span>
                <input
                  id="sop-date"
                  onChange={(event) => setSpec({ ...spec, date: event.target.value })}
                  placeholder="January 1, 2026"
                  value={spec.date}
                />
              </label>
              <label className="field wide-field">
                <span className="field-label">Subject</span>
                <input
                  id="sop-subject"
                  onChange={(event) => setSpec({ ...spec, subject: event.target.value })}
                  placeholder="Fall Prevention Program"
                  value={spec.subject}
                />
              </label>
              <label className="field wide-field">
                <span className="field-label">Proponent</span>
                <input
                  onChange={(event) => setSpec({ ...spec, proponent: event.target.value })}
                  placeholder="Department of ___ (DCN ___)"
                  value={spec.proponent}
                />
              </label>
            </div>
          </section>

          {spec.mode === "convert" && (
            <ConvertPanel
              documentType={spec.documentType}
              onConverted={(nextSpec, message) => loadSpec(nextSpec, message || "Converted legacy text.")}
            />
          )}

          <section aria-labelledby="references-title" className="editor-surface" id="references-editor" tabIndex={-1}>
            <div className="section-heading-row">
              <h2 id="references-title">References</h2>
            </div>
            <StringListEditor
              label="Enclosure 1 references"
              onChange={(references) => setSpec({ ...spec, references })}
              placeholder='DHA-Procedural Instruction 5025.01, "Publication System," April 1, 2022'
              values={spec.references}
            />
          </section>

          <section aria-labelledby="sections-title" className="editor-stack" id="sections-editor" tabIndex={-1}>
            <div className="section-heading-row">
              <div>
                <p className="section-kicker">Above signature</p>
                <h2 id="sections-title">Required sections</h2>
              </div>
            </div>
            {SECTION_LABELS.map((section) => (
              <SectionEditor
                key={section.key}
                label={section.label}
                nodes={spec.sections[section.key] as ParagraphNode[] | null}
                onChange={(nodes) => updateSections(section.key, nodes as never)}
                optional={section.optional}
              />
            ))}
            <section className="editor-surface">
              <div className="form-grid">
                <label className="field">
                  <span className="field-label">Releasability</span>
                  <select
                    value={spec.sections.releasability}
                    onChange={(event) =>
                      setSpec({
                        ...spec,
                        sections: {
                          ...spec.sections,
                          releasability: event.target.value as SopSpec["sections"]["releasability"]
                        }
                      })
                    }
                  >
                    <option value="notPublic">Not cleared for public release</option>
                    <option value="public">Cleared for public release</option>
                  </select>
                </label>
                <label className="field">
                  <span className="field-label">Expires after years</span>
                  <input
                    min={1}
                    max={30}
                    onChange={(event) =>
                      setSpec({
                        ...spec,
                        sections: {
                          ...spec.sections,
                          effectiveDate: {
                            ...spec.sections.effectiveDate,
                            expiresYears: Number(event.target.value) || 10
                          }
                        }
                      })
                    }
                    type="number"
                    value={spec.sections.effectiveDate.expiresYears}
                  />
                </label>
              </div>
            </section>
          </section>

          <section aria-labelledby="enclosures-title" className="editor-stack" id="enclosures-editor" tabIndex={-1}>
            <div className="section-heading-row">
              <div>
                <p className="section-kicker">After signature</p>
                <h2 id="enclosures-title">Enclosures</h2>
              </div>
            </div>
            <section className="editor-surface">
              <h3>Enclosure 2 - Responsibilities</h3>
              <BlockEditor
                ariaLabel="Responsibilities enclosure"
                nodes={spec.enclosures.responsibilities}
                onChange={(responsibilities) =>
                  setSpec({ ...spec, enclosures: { ...spec.enclosures, responsibilities } })
                }
              />
            </section>
            <section className="editor-surface">
              <h3>Enclosure 3 - Procedures</h3>
              <BlockEditor
                ariaLabel="Procedures enclosure"
                nodes={spec.enclosures.procedures}
                onChange={(procedures) =>
                  setSpec({ ...spec, enclosures: { ...spec.enclosures, procedures } })
                }
              />
            </section>
            <AppendicesEditor spec={spec} setSpec={setSpec} />
            <GlossaryEditor spec={spec} setSpec={setSpec} />
          </section>

          <section aria-labelledby="signature-title" className="editor-surface" id="signature-editor" tabIndex={-1}>
            <div className="section-heading-row">
              <div>
                <p className="section-kicker">Approval</p>
                <h2 id="signature-title">Signature block</h2>
              </div>
            </div>
            <div className="form-grid">
              <label className="field">
                <span className="field-label">Approval authority</span>
                <select
                  value={spec.signature.approvalAuthority}
                  onChange={(event) =>
                    setSpec({
                      ...spec,
                      signature: {
                        ...spec.signature,
                        approvalAuthority: event.target.value as SopSpec["signature"]["approvalAuthority"]
                      }
                    })
                  }
                >
                  <option value="deputy">Deputy</option>
                  <option value="commander">Hospital Commander</option>
                </select>
              </label>
              <label className="field">
                <span className="field-label">Signer name</span>
                <input
                  onChange={(event) =>
                    setSpec({ ...spec, signature: { ...spec.signature, name: event.target.value } })
                  }
                  value={spec.signature.name}
                />
              </label>
              <label className="field">
                <span className="field-label">Rank and branch</span>
                <input
                  onChange={(event) =>
                    setSpec({ ...spec, signature: { ...spec.signature, rankBranch: event.target.value } })
                  }
                  value={spec.signature.rankBranch}
                />
              </label>
              <label className="field wide-field">
                <span className="field-label">Title</span>
                <input
                  onChange={(event) =>
                    setSpec({
                      ...spec,
                      signature: { ...spec.signature, title: [event.target.value] }
                    })
                  }
                  value={spec.signature.title[0] ?? ""}
                />
              </label>
            </div>
          </section>
        </section>

        <aside aria-label="Review rail" className="review-rail" id="review-stage" tabIndex={-1}>
          <StructuralPreview spec={spec} />
          <CompliancePanel onNavigate={onComplianceNavigate} validation={validation} />
          <ReadinessPanel spec={spec} setSpec={setSpec} />
          <section className="panel-section">
            <div className="section-heading-row">
              <h2>Draft tools</h2>
            </div>
            <div className="tool-grid">
              <button
                className="secondary-button"
                onClick={() => downloadText(exportDraft(spec), "sopwriter-draft.json")}
                type="button"
              >
                Save draft JSON
              </button>
              <button
                className="secondary-button"
                onClick={() => importInputRef.current?.click()}
                type="button"
              >
                Load draft JSON
              </button>
              <button
                className="secondary-button"
                onClick={() => {
                  const fixed = fixSentenceSpacing(spec);
                  setSpacingProposal(fixed);
                  loadSpec(fixed, "Applied two-space sentence spacing where detected.");
                }}
                type="button"
              >
                Fix sentence spacing
              </button>
              <button
                className="secondary-button"
                onClick={() => {
                  clearActiveDraft();
                  loadSpec(createDefaultSpec(), "Cleared local draft data.");
                }}
                type="button"
              >
                Clear local draft
              </button>
            </div>
            <input
              accept="application/json,.json"
              hidden
              onChange={handleImport}
              ref={importInputRef}
              type="file"
            />
            {spacingProposal && <p className="helper-text">Sentence spacing fix has been applied to the current draft.</p>}
            <p className="status-line" role="status">{feedback}</p>
            <p className="helper-text">
              Approval authority: {approvalAuthorityLabel(spec.signature.approvalAuthority)}.
            </p>
          </section>
        </aside>
      </main>

      <AskDrHoltkampPanel
        canUndo={!!assistantUndoSpec}
        isOpen={isAssistantOpen}
        messages={assistantMessages}
        onApplySpec={applyAssistantSpec}
        onClose={() => setAssistantOpen(false)}
        onMessagesChange={setAssistantMessages}
        onUndo={undoAssistant}
        spec={spec}
        validation={validation}
      />
    </div>
  );
}
