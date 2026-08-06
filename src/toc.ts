import GithubSlugger from "github-slugger";
import { toString as mdastToString } from "mdast-util-to-string";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { visit } from "unist-util-visit";

import type { TocEntry } from "./types.js";

import type { Root } from "mdast";

const processor = unified().use(remarkParse).use(remarkGfm);

function parse(markdown: string): Root {
  return processor.parse(markdown);
}

export interface TocOptions {
  /** Shallowest heading to include. Defaults to 2 — `#` is the article title. */
  minDepth?: number;
  /** Deepest heading to include. Defaults to 3; deeper nesting reads as clutter. */
  maxDepth?: number;
}

/**
 * Every heading in the document, with the anchor id it will render with.
 *
 * Ids come from `github-slugger`, which is the same slugger `rehype-slug` uses.
 * That matters more than it looks: the id is computed here, in a separate pass
 * from the one that renders the heading, and the two must agree or every TOC
 * link is a dead anchor. Sharing the implementation — including its duplicate
 * counter, which suffixes a repeated heading `-1`, `-2` — is what keeps them
 * honest. A slugger instance is stateful, so one is created per document.
 */
export function extractHeadings(markdown: string): TocEntry[] {
  const slugger = new GithubSlugger();
  const entries: TocEntry[] = [];

  visit(parse(markdown), "heading", (node) => {
    const text = mdastToString(node).trim();
    if (text === "") return;
    entries.push({ id: slugger.slug(text), text, depth: node.depth });
  });

  return entries;
}

/**
 * The clickable table of contents for one article.
 *
 * Returns an empty list when the article has fewer than two eligible headings:
 * a table of contents with a single entry is navigation that saves no one a
 * scroll, and it costs a reader the vertical space before the first paragraph.
 */
export function extractToc(markdown: string, options: TocOptions = {}): TocEntry[] {
  const minDepth = options.minDepth ?? 2;
  const maxDepth = options.maxDepth ?? 3;

  const eligible = extractHeadings(markdown).filter(
    (h) => h.depth >= minDepth && h.depth <= maxDepth,
  );

  return eligible.length >= 2 ? eligible : [];
}

/**
 * The article's prose, with markdown syntax flattened away — what search should
 * match against. Code blocks are dropped: searching documentation for a word
 * should not rank an article because the word appears in a sample payload.
 */
export function extractPlainText(markdown: string): string {
  const tree = parse(markdown);
  const parts: string[] = [];

  visit(tree, (node) => {
    if (node.type === "code" || node.type === "inlineCode") return "skip";
    if (node.type === "text") parts.push((node as { value: string }).value);
    return undefined;
  });

  return parts.join(" ").replace(/\s+/g, " ").trim();
}
