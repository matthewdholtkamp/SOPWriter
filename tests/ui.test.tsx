import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import App from "../src/App";

describe("SOP Writer UI", () => {
  it("renders authoring controls and enables conversion mode", async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getByText("SOP Writer")).toBeInTheDocument();
    expect(screen.getByLabelText("Subject")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Convert" }));
    expect(screen.getByLabelText("Legacy MEDDAC text")).toBeInTheDocument();
  });
});
