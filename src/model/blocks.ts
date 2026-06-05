import { sopLabel } from "../generator/format";
import type { ParagraphNode } from "./sopSpec";

export type EditorBlock = {
  id: string;
  depth: number;
  heading?: string;
  text: string;
};

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
}

export function paragraphsToBlocks(nodes: ParagraphNode[], depth = 0): EditorBlock[] {
  return nodes.flatMap((node) => [
    {
      id: newId(),
      depth,
      heading: node.heading ?? "",
      text: node.text
    },
    ...paragraphsToBlocks(node.children, depth + 1)
  ]);
}

export function blocksToParagraphs(blocks: EditorBlock[]): ParagraphNode[] {
  const roots: ParagraphNode[] = [];
  const stack: Array<{ depth: number; node: ParagraphNode }> = [];

  for (const block of normalizeBlockDepths(blocks)) {
    const node: ParagraphNode = {
      heading: block.heading?.trim() || undefined,
      text: block.text,
      children: []
    };
    while (stack.length && stack[stack.length - 1].depth >= block.depth) {
      stack.pop();
    }
    if (stack.length === 0) {
      roots.push(node);
    } else {
      stack[stack.length - 1].node.children.push(node);
    }
    stack.push({ depth: block.depth, node });
  }

  return roots;
}

export function normalizeBlockDepths(blocks: EditorBlock[]): EditorBlock[] {
  let previousDepth = 0;
  return blocks.map((block, index) => {
    const maxDepth = index === 0 ? 0 : Math.min(5, previousDepth + 1);
    const depth = Math.max(0, Math.min(maxDepth, block.depth));
    previousDepth = depth;
    return { ...block, depth };
  });
}

export function flattenParagraphs(nodes: ParagraphNode[], depth = 0): Array<{ node: ParagraphNode; depth: number }> {
  return nodes.flatMap((node) => [
    { node, depth },
    ...flattenParagraphs(node.children, depth + 1)
  ]);
}

export function blockLabel(blocks: EditorBlock[], index: number): string {
  const block = blocks[index];
  const siblingOrdinal =
    blocks
      .slice(0, index + 1)
      .filter((candidate) => candidate.depth === block.depth).length;
  return sopLabel(block.depth, siblingOrdinal);
}

export function ensureBlocks(nodes: ParagraphNode[]): EditorBlock[] {
  const blocks = paragraphsToBlocks(nodes);
  return blocks.length ? blocks : [{ id: newId(), depth: 0, heading: "", text: "" }];
}
