import type { ComplianceItem, ValidationResult } from "../validation/validate";
import { AlertIcon, CheckIcon, XIcon } from "./icons";

export function CompliancePanel({
  onNavigate,
  validation
}: {
  onNavigate: (item: ComplianceItem) => void;
  validation: ValidationResult;
}) {
  const issues = validation.items
    .filter((item) => item.level !== "pass")
    .sort((left, right) => (left.level === "fail" ? -1 : right.level === "fail" ? 1 : 0));
  const passed = validation.items.filter((item) => item.level === "pass");

  return (
    <section aria-labelledby="compliance-title" className="panel-section" id="compliance-panel">
      <div className="section-heading-row">
        <h2 id="compliance-title">Compliance</h2>
        <span className={`status-summary ${validation.canGenerate ? "ready" : "blocked"}`}>
          {validation.canGenerate ? "Ready" : "Needs attention"}
        </span>
      </div>
      <div className="compliance-list" aria-live="polite">
        {issues.length === 0 && (
          <p className="compliance-ready-copy">No compliance issues need attention.</p>
        )}
        {issues.map((item) => (
          <button
            className={`compliance-item ${item.level}`}
            key={`${item.code}-${item.label}`}
            onClick={() => onNavigate(item)}
            type="button"
          >
            <span className="compliance-icon">
              {item.level === "warn" ? <AlertIcon /> : <XIcon />}
            </span>
            <span>
              <strong>{item.label}</strong>
              <small>{item.detail}</small>
            </span>
          </button>
        ))}
        <details className="passed-checks">
          <summary>Passed checks ({passed.length})</summary>
          {passed.map((item) => (
            <div className="compliance-item pass" key={`${item.code}-${item.label}`}>
              <span className="compliance-icon">
                <CheckIcon />
              </span>
              <span>
                <strong>{item.label}</strong>
                <small>{item.detail}</small>
              </span>
            </div>
          ))}
        </details>
      </div>
    </section>
  );
}
