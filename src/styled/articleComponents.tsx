import { StyledHeading, StyledText } from "stonedog-style";
import { css } from "styled-system/css";

import type { ArticleComponents } from "../render/renderArticle";

/**
 * The article body, rendered with `stonedog-style`.
 *
 * This is one `ArticleComponents` map among any number a host might write — the
 * renderer has no dependency on it, and importing it is what opts a consumer
 * into Panda and the design system. A host with its own components passes its
 * own map and never loads this module.
 *
 * Every element that can carry a heading anchor MUST spread its props. The id
 * arrives that way from `rehype-slug`, and a component that drops it kills every
 * table-of-contents link in the article at once, silently — the link stays live
 * and the page just does not move. `styled.test.tsx` asserts the ids survive
 * this map specifically, not only a bare spread.
 */

const listStyles = css({
  display: "flex",
  flexDirection: "column",
  gap: "2",
  paddingLeft: "6",
  marginBlock: "3",
});

const codeStyles = css({
  fontFamily: "mono",
  fontSize: "sm",
  paddingInline: "1",
  paddingBlock: "0.5",
  borderRadius: "sm",
  backgroundColor: "gray.100",
  _dark: { backgroundColor: "gray.800" },
});

const preStyles = css({
  fontFamily: "mono",
  fontSize: "sm",
  padding: "4",
  borderRadius: "md",
  overflowX: "auto",
  backgroundColor: "gray.100",
  _dark: { backgroundColor: "gray.800" },
});

const quoteStyles = css({
  borderLeftWidth: "4px",
  borderLeftColor: "gray.300",
  paddingLeft: "4",
  marginBlock: "3",
  fontStyle: "italic",
  _dark: { borderLeftColor: "gray.600" },
});

// A wide table must scroll inside its own box. Letting it push the article
// wider makes the whole page scroll sideways, which breaks every other
// paragraph on a narrow screen to show one table.
const tableWrapStyles = css({ overflowX: "auto", marginBlock: "3" });
const tableStyles = css({ width: "full", borderCollapse: "collapse", fontSize: "sm" });
const cellStyles = css({
  borderWidth: "1px",
  borderColor: "gray.200",
  paddingInline: "3",
  paddingBlock: "2",
  textAlign: "left",
  _dark: { borderColor: "gray.700" },
});

const linkStyles = css({
  color: "blue.600",
  textDecoration: "underline",
  _dark: { color: "blue.300" },
});

export const stonedogArticleComponents: ArticleComponents = {
  h1: ({ children, ...rest }) => (
    <StyledHeading {...rest} as="h2">
      {children}
    </StyledHeading>
  ),
  h2: ({ children, ...rest }) => (
    <StyledHeading {...rest} as="h2">
      {children}
    </StyledHeading>
  ),
  h3: ({ children, ...rest }) => (
    <StyledHeading {...rest} as="h3">
      {children}
    </StyledHeading>
  ),
  h4: ({ children, ...rest }) => (
    <StyledHeading {...rest} as="h4">
      {children}
    </StyledHeading>
  ),
  p: ({ children, ...rest }) => (
    <StyledText {...rest} as="p">
      {children}
    </StyledText>
  ),
  ul: ({ children, ...rest }) => (
    <ul {...rest} className={listStyles}>
      {children}
    </ul>
  ),
  ol: ({ children, ...rest }) => (
    <ol {...rest} className={listStyles}>
      {children}
    </ol>
  ),
  a: ({ children, ...rest }) => (
    <a {...rest} className={linkStyles}>
      {children}
    </a>
  ),
  code: ({ children, ...rest }) => (
    <code {...rest} className={codeStyles}>
      {children}
    </code>
  ),
  pre: ({ children, ...rest }) => (
    <pre {...rest} className={preStyles}>
      {children}
    </pre>
  ),
  blockquote: ({ children, ...rest }) => (
    <blockquote {...rest} className={quoteStyles}>
      {children}
    </blockquote>
  ),
  table: ({ children, ...rest }) => (
    <div className={tableWrapStyles}>
      <table {...rest} className={tableStyles}>
        {children}
      </table>
    </div>
  ),
  th: ({ children, ...rest }) => (
    <th {...rest} className={cellStyles}>
      {children}
    </th>
  ),
  td: ({ children, ...rest }) => (
    <td {...rest} className={cellStyles}>
      {children}
    </td>
  ),
};
