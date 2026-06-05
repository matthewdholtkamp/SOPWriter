import { useEffect, useRef, useState, type RefObject } from "react";
import { publicationKindLabel, sopLabel } from "../generator/format";
import { getProfile } from "../model/profiles";
import type { ParagraphNode, SopSpec } from "../model/sopSpec";

type StructuralPreviewProps = {
  spec: SopSpec;
};

function flattenPreviewParagraphs(
  paragraphs: ParagraphNode[],
  depth = 0
): Array<{ depth: number; label: string; text: string; heading?: string }> {
  return paragraphs.flatMap((paragraph, index) => [
    {
      depth,
      label: sopLabel(depth, index + 1),
      text: paragraph.text,
      heading: paragraph.heading
    },
    ...flattenPreviewParagraphs(paragraph.children, depth + 1)
  ]);
}

function sectionPreview(title: string, nodes: ParagraphNode[], number: number) {
  const first = nodes.find((node) => node.text.trim() || node.heading?.trim());
  if (!first) return null;
  return (
    <p key={title}>
      <strong>{number}. {title}. </strong>
      {first.text || "[Section text]"}
    </p>
  );
}

function PaperPreview({ expanded = false, spec }: StructuralPreviewProps & { expanded?: boolean }) {
  const profile = getProfile(spec.profileId);
  const responsibilityPreview = flattenPreviewParagraphs(spec.enclosures.responsibilities).slice(0, expanded ? 5 : 2);
  const procedurePreview = flattenPreviewParagraphs(spec.enclosures.procedures).slice(0, expanded ? 5 : 2);
  let sectionNumber = 1;
  const optionalSections = [
    sectionPreview("PURPOSE", spec.sections.purpose, sectionNumber++),
    sectionPreview("APPLICABILITY", spec.sections.applicability, sectionNumber++),
    sectionPreview("POLICY IMPLEMENTATION", spec.sections.policyImplementation, sectionNumber++),
    spec.sections.canceledDocuments ? sectionPreview("CANCELED DOCUMENTS", spec.sections.canceledDocuments, sectionNumber++) : null,
    sectionPreview("RESPONSIBILITIES", spec.sections.responsibilitiesBrief, sectionNumber++),
    sectionPreview("PROCEDURES", spec.sections.proceduresBrief, sectionNumber++)
  ].filter(Boolean);

  return (
    <div
      aria-label={expanded ? "Expanded publication preview" : "Approximate publication structure"}
      className={`paper-preview ${expanded ? "expanded" : ""}`}
    >
      <div className="preview-letterhead">
        {profile.headerLines.map((line) => (
          <span key={line}>{line}</span>
        ))}
      </div>
      <p className="preview-designation">
        GLWCH {publicationKindLabel(spec.documentType)} No. {spec.publicationNumber || "[NUMBER]"}
      </p>
      <p>{spec.date || "[DATE]"}</p>
      <p>{spec.proponent || "[PROPONENT]"}</p>
      <p className="preview-subject">SUBJECT: {spec.subject || "[SUBJECT]"}</p>
      <p>References: See Enclosure 1.</p>
      <div className="preview-body">{optionalSections}</div>
      <div className="preview-signature">
        <span>{spec.signature.name.toUpperCase() || "[SIGNER NAME]"}</span>
        <span>{spec.signature.rankBranch || "[RANK, BRANCH]"}</span>
        <span>{spec.signature.title[0] || "[TITLE]"}</span>
      </div>
      <hr />
      <p className="preview-enclosure">ENCLOSURE 1 - REFERENCES ({spec.references.filter(Boolean).length})</p>
      <p className="preview-enclosure">ENCLOSURE 2 - RESPONSIBILITIES</p>
      {responsibilityPreview.map((paragraph, index) => (
        <p key={`r-${index}`} style={{ marginLeft: `${paragraph.depth * 14}px` }}>
          {paragraph.label} {paragraph.heading ? `${paragraph.heading}. ` : ""}{paragraph.text}
        </p>
      ))}
      <p className="preview-enclosure">ENCLOSURE 3 - PROCEDURES</p>
      {procedurePreview.map((paragraph, index) => (
        <p key={`p-${index}`} style={{ marginLeft: `${paragraph.depth * 14}px` }}>
          {paragraph.label} {paragraph.heading ? `${paragraph.heading}. ` : ""}{paragraph.text}
        </p>
      ))}
    </div>
  );
}

function PreviewDialog({
  onClose,
  returnFocusRef,
  spec
}: StructuralPreviewProps & {
  onClose: () => void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      returnFocusRef.current?.focus();
    };
  }, [onClose, returnFocusRef]);

  return (
    <div className="modal-backdrop preview-backdrop" role="presentation">
      <section
        aria-labelledby="expanded-preview-title"
        aria-modal="true"
        className="modal preview-modal"
        role="dialog"
      >
        <div className="modal-heading">
          <div>
            <p className="section-kicker">Word layout approximation</p>
            <h2 id="expanded-preview-title">Expanded preview</h2>
          </div>
          <button
            className="secondary-button"
            onClick={onClose}
            ref={closeButtonRef}
            type="button"
          >
            Close preview
          </button>
        </div>
        <p className="helper-text">
          Final pagination, wrapping, and enclosure breaks are set in the downloaded Word document.
        </p>
        <PaperPreview expanded spec={spec} />
      </section>
    </div>
  );
}

export function StructuralPreview({ spec }: StructuralPreviewProps) {
  const [expanded, setExpanded] = useState(false);
  const expandButtonRef = useRef<HTMLButtonElement>(null);

  return (
    <section className="preview-section panel-section" aria-labelledby="preview-title">
      <div className="section-heading-row">
        <h2 id="preview-title">Structural preview</h2>
        <button
          className="text-button"
          onClick={() => setExpanded(true)}
          ref={expandButtonRef}
          type="button"
        >
          Expand preview
        </button>
      </div>
      <PaperPreview spec={spec} />
      {expanded && (
        <PreviewDialog
          onClose={() => setExpanded(false)}
          returnFocusRef={expandButtonRef}
          spec={spec}
        />
      )}
    </section>
  );
}
