import { describe, expect, it } from "vitest";
import { blockLabel, blocksToParagraphs, normalizeBlockDepths, type EditorBlock } from "../src/model/blocks";

describe("SOP block helpers", () => {
  it("normalizes depths and produces DHA labels", () => {
    const blocks: EditorBlock[] = normalizeBlockDepths([
      { id: "1", depth: 0, text: "Root" },
      { id: "2", depth: 4, text: "Child one" },
      { id: "3", depth: 2, text: "Child two" }
    ]);
    expect(blocks.map((block) => block.depth)).toEqual([0, 1, 2]);
    expect(blocks.map((_, index) => blockLabel(blocks, index))).toEqual(["1.", "a.", "(1)"]);
  });

  it("turns flat blocks into paragraph trees", () => {
    const nodes = blocksToParagraphs([
      { id: "1", depth: 0, heading: "Official", text: "Acts." },
      { id: "2", depth: 1, text: "Child one." },
      { id: "3", depth: 1, text: "Child two." }
    ]);
    expect(nodes[0].heading).toBe("Official");
    expect(nodes[0].children).toHaveLength(2);
  });
});
