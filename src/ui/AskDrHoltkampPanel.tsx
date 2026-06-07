import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type KeyboardEvent,
  type SetStateAction
} from "react";
import { createAssistantMessage, runSopAssistant } from "../assistant/session";
import type { AssistantMessage } from "../assistant/schema";
import type { SopSpec } from "../model/sopSpec";
import type { ValidationResult } from "../validation/validate";

function AssistantMessageCard({ message }: { message: AssistantMessage }) {
  return (
    <article className={`ask-message ${message.role}`}>
      <strong>{message.role === "user" ? "You" : "Dr. Holtkamp"}</strong>
      <p>{message.text}</p>
      {message.appliedFields && message.appliedFields.length > 0 && (
        <div className="ask-chip-row" aria-label="Applied SOP fields">
          {message.appliedFields.map((field) => (
            <span className="ask-chip" key={field}>
              {field}
            </span>
          ))}
        </div>
      )}
      {message.warnings && message.warnings.length > 0 && (
        <ul className="ask-note-list">
          {message.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
      {message.questions && message.questions.length > 0 && (
        <ul className="ask-note-list questions">
          {message.questions.map((question) => (
            <li key={question}>{question}</li>
          ))}
        </ul>
      )}
    </article>
  );
}

export function AskDrHoltkampPanel({
  canUndo,
  isOpen,
  messages,
  onApplySpec,
  onClose,
  onMessagesChange,
  onUndo,
  spec,
  validation
}: {
  canUndo: boolean;
  isOpen: boolean;
  messages: AssistantMessage[];
  onApplySpec: (nextSpec: SopSpec, fields: string[]) => void;
  onClose: () => void;
  onMessagesChange: Dispatch<SetStateAction<AssistantMessage[]>>;
  onUndo: () => void;
  spec: SopSpec;
  validation: ValidationResult;
}) {
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const specRef = useRef(spec);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    specRef.current = spec;
  }, [spec]);

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  const seedPrompt = (prompt: string) => {
    setInput(prompt);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const userText = input.trim();
    if (!userText || isSending) return;

    const userMessage = createAssistantMessage("user", userText);
    const nextMessages = [...messages, userMessage];
    onMessagesChange(nextMessages);
    setInput("");
    setIsSending(true);

    try {
      const { appliedFields, nextSpec, response } = await runSopAssistant({
        userText,
        messages: nextMessages,
        spec: specRef.current,
        validationItems: validation.items
      });

      if (nextSpec) {
        onApplySpec(nextSpec, appliedFields);
      }

      onMessagesChange((current) => [
        ...current,
        createAssistantMessage("assistant", response.assistantMessage, {
          appliedFields,
          warnings: response.warnings,
          questions: response.questions
        })
      ]);
    } catch (error) {
      onMessagesChange((current) => [
        ...current,
        createAssistantMessage(
          "assistant",
          error instanceof Error
            ? `I could not apply that yet: ${error.message}`
            : "I could not apply that yet. Check the network connection and try again."
        )
      ]);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <aside
      aria-label="Ask Dr. Holtkamp SOP assistant"
      className={`ask-panel ${isOpen ? "open" : ""}`}
      hidden={!isOpen}
    >
      <div className="ask-panel-heading">
        <div>
          <p className="section-kicker">Gemini SOP assist</p>
          <h2>Ask Dr. Holtkamp</h2>
        </div>
        <button className="secondary-button" onClick={onClose} type="button">
          Close
        </button>
      </div>
      <p className="ask-privacy-note">
        Uses the shared Bandaid6 Gemini Worker only when you send a message. Do not enter PHI,
        patient details, classified content, or sensitive personal data.
      </p>
      <div className="ask-quick-actions" aria-label="Assistant shortcuts">
        <button
          aria-label="Map legacy policy"
          className="ask-shortcut-card"
          onClick={() => seedPrompt("Map this legacy MEDDAC policy into the GLWCH DHA-format SOP structure:\n\n")}
          type="button"
        >
          <strong>Map legacy policy</strong>
          <span>Convert pasted text</span>
        </button>
        <button
          aria-label="Draft responsibilities"
          className="ask-shortcut-card"
          onClick={() => seedPrompt("Draft responsibilities for these officials, assigning actions to officials rather than offices:\n\n")}
          type="button"
        >
          <strong>Draft responsibilities</strong>
          <span>Build Enclosure 2</span>
        </button>
        <button
          aria-label="Review current SOP"
          className="ask-shortcut-card"
          onClick={() =>
            seedPrompt("Review the current SOP for missing required fields, prohibited shall usage, and move-impacted procedures. Do not invent missing facts.")
          }
          type="button"
        >
          <strong>Review current SOP</strong>
          <span>Find gaps</span>
        </button>
      </div>
      <div className="ask-history" aria-live="polite">
        {messages.length === 0 ? (
          <article className="ask-message assistant">
            <strong>Dr. Holtkamp</strong>
            <p>
              Paste old policy text or give rough instructions. I will propose validated SOP field
              updates and show the warnings or questions that remain.
            </p>
          </article>
        ) : (
          messages.map((message) => <AssistantMessageCard key={message.id} message={message} />)
        )}
      </div>
      <form className="ask-form" onSubmit={handleSubmit}>
        <label className="field-label" htmlFor="ask-message">
          Message Dr. Holtkamp
        </label>
        <textarea
          id="ask-message"
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleInputKeyDown}
          placeholder="Paste text or ask for a specific SOP section..."
          ref={inputRef}
          rows={5}
          value={input}
        />
        <div className="ask-form-actions">
          <button className="primary-button" disabled={!input.trim() || isSending} type="submit">
            {isSending ? "Sending..." : "Send"}
          </button>
          <button
            className="secondary-button"
            disabled={!canUndo}
            onClick={onUndo}
            type="button"
          >
            Undo last update
          </button>
        </div>
      </form>
    </aside>
  );
}
