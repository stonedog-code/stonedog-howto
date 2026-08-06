import { parse as parseYaml } from "yaml";

import { ArticleParseError } from "./errors.js";

export interface SplitDocument {
  /** The parsed frontmatter block. Empty when the document had none. */
  data: Record<string, unknown>;
  /** Everything after the closing fence, with leading blank lines trimmed. */
  body: string;
}

/** Byte-order mark. Editors on Windows leave these and they break the fence match. */
const BOM = "﻿";

/**
 * Split a `---`-fenced YAML frontmatter block off the front of a document.
 *
 * A real YAML parser is used rather than a hand-rolled key/value scanner. The
 * scanner is always fine until the first article wants a list, a colon inside a
 * title, or a quoted string — and by then the format is load-bearing across
 * every article in every consuming app, and its bugs are indistinguishable from
 * authoring mistakes.
 *
 * A document with no opening fence is not an error: it parses as a body with no
 * metadata, and the article layer is what insists on the required fields.
 */
export function splitFrontmatter(source: string, sourcePath?: string): SplitDocument {
  const text = source.startsWith(BOM) ? source.slice(BOM.length) : source;
  const normalised = text.replace(/\r\n/g, "\n");

  if (!/^---[ \t]*\n/.test(normalised)) {
    return { data: {}, body: normalised.replace(/^\n+/, "") };
  }

  const afterOpening = normalised.indexOf("\n") + 1;
  // The closing fence is a line that is exactly `---`. Searching for the next
  // one rather than the last means a `---` horizontal rule later in the body
  // cannot swallow the whole article into its frontmatter.
  const closing = /^---[ \t]*$/m.exec(normalised.slice(afterOpening));

  if (!closing) {
    throw new ArticleParseError(
      "frontmatter block was opened with `---` but never closed",
      sourcePath,
    );
  }

  const yamlText = normalised.slice(afterOpening, afterOpening + closing.index);
  const bodyStart = afterOpening + closing.index + closing[0].length;

  let data: unknown;
  try {
    data = parseYaml(yamlText);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new ArticleParseError(`frontmatter is not valid YAML — ${detail}`, sourcePath);
  }

  if (data === null || data === undefined) {
    return { data: {}, body: normalised.slice(bodyStart).replace(/^\n+/, "") };
  }

  if (typeof data !== "object" || Array.isArray(data)) {
    throw new ArticleParseError(
      "frontmatter must be a block of key/value pairs",
      sourcePath,
    );
  }

  return {
    data: data as Record<string, unknown>,
    body: normalised.slice(bodyStart).replace(/^\n+/, ""),
  };
}
