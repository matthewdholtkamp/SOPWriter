import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";

function geminiResponse(text: string): Response {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text }] } }]
    }),
    { headers: { "Content-Type": "application/json" } }
  );
}

describe("SOP Writer UI", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("renders authoring controls and enables conversion mode", async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getByText("SOP Writer")).toBeInTheDocument();
    expect(screen.getByLabelText("Subject")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Convert" }));
    expect(screen.getByLabelText("Legacy MEDDAC text")).toBeInTheDocument();
    expect(screen.getByText("Drop old PAM/REG PDF here")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose file" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Convert with Dr. Holtkamp" })).toBeDisabled();
  });

  it("loads legacy text through the convert file input", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Convert" }));

    const legacyFile = new File(["Purpose\r\nLoaded from upload."], "legacy.txt", {
      type: "text/plain"
    });
    await user.upload(screen.getByLabelText("Choose legacy policy file"), legacyFile);

    expect(await screen.findByText("Loaded text from legacy.txt.")).toBeInTheDocument();
    expect(screen.getByLabelText("Legacy MEDDAC text")).toHaveValue("Purpose\nLoaded from upload.");
  });

  it("maps pasted legacy text through Gemini when Convert is clicked", async () => {
    const user = userEvent.setup();
    const legacyText = "MEDDAC Pam 40-7\nUse of Blood and Blood Products\nPurpose\nLegacy policy body.";
    const payload = {
      assistantMessage: "I mapped the legacy policy.",
      action: "applyPatch",
      specPatch: {
        mode: "convert",
        subject: "AI Converted Blood Products",
        sections: {
          purpose: [{ text: "This publication establishes blood product procedures.", children: [] }]
        }
      },
      changedFields: [{ field: "subject" }],
      warnings: ["Confirm the proponent."],
      questions: ["What is the local blood bank workflow owner?"]
    };
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      geminiResponse(JSON.stringify(payload))
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await user.click(screen.getByRole("button", { name: "Convert" }));
    await user.click(screen.getByLabelText("Legacy MEDDAC text"));
    await user.paste(legacyText);
    await user.click(screen.getByRole("button", { name: "Convert with Dr. Holtkamp" }));

    expect(await screen.findByDisplayValue("AI Converted Blood Products")).toBeInTheDocument();
    expect(await screen.findByText("I mapped the legacy policy.")).toBeInTheDocument();
    expect(screen.getByText("Confirm the proponent.")).toBeInTheDocument();
    expect(screen.getByText("What is the local blood bank workflow owner?")).toBeInTheDocument();

    const init = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(init?.body as string);
    const context = JSON.parse(body.contents[0].parts[0].text);
    expect(context.instruction).toContain(legacyText);
    expect(context.recentConversation).toEqual([
      { role: "user", text: "Convert legacy policy from pasted/uploaded text." }
    ]);
  });

  it("falls back to the rough converter when Gemini fails", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network down");
    }));

    render(<App />);
    await user.click(screen.getByRole("button", { name: "Convert" }));
    await user.click(screen.getByLabelText("Legacy MEDDAC text"));
    await user.paste("MEDDAC Pam 40-7\nUse of Blood and Blood Products\n11 DEC 2024\nPurpose\nThis pamphlet establishes local procedures.");
    await user.click(screen.getByRole("button", { name: "Convert with Dr. Holtkamp" }));

    expect(await screen.findByLabelText("Subject")).toHaveValue("Use of Blood and Blood Products");
    expect((await screen.findAllByText(/Gemini could not map this automatically/)).length).toBeGreaterThan(0);
    expect(
      screen.getByText("I could not apply a structured AI conversion. SOP Writer used the rough converter.")
    ).toBeInTheDocument();
  });
});
