import type { SopStage, ValidationResult } from "../validation/validate";

const STAGES: Array<{ id: SopStage; label: string }> = [
  { id: "identity", label: "Identity" },
  { id: "sections", label: "Sections" },
  { id: "enclosures", label: "Enclosures" },
  { id: "readiness", label: "Readiness" },
  { id: "review", label: "Review" }
];

function stageStatus(
  stage: SopStage,
  activeStage: SopStage,
  validation: ValidationResult
): "current" | "complete" | "attention" {
  if (stage === activeStage) return "current";
  return validation.items.some(
    (item) => item.stage === stage && item.level !== "pass"
  )
    ? "attention"
    : "complete";
}

export function SopStageStrip({
  activeStage,
  onSelect,
  validation
}: {
  activeStage: SopStage;
  onSelect: (stage: SopStage) => void;
  validation: ValidationResult;
}) {
  return (
    <nav aria-label="SOP progress" className="stage-strip">
      {STAGES.map((stage, index) => {
        const status = stageStatus(stage.id, activeStage, validation);
        const statusLabel =
          status === "current"
            ? "Current step"
            : status === "complete"
              ? "Complete"
              : "Needs attention";
        return (
          <button
            aria-label={`${index + 1}. ${stage.label}: ${statusLabel}`}
            aria-current={status === "current" ? "step" : undefined}
            className={`stage-button ${status}`}
            key={stage.id}
            onClick={() => onSelect(stage.id)}
            type="button"
          >
            <span className="stage-number">{index + 1}</span>
            <span>
              <strong>{stage.label}</strong>
              <small>{statusLabel}</small>
            </span>
          </button>
        );
      })}
    </nav>
  );
}
