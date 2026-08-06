# @stonedogcode/howto

A how-to documentation surface for applications.

Articles are markdown files that **describe themselves**. This package turns a
directory of them into an arranged, access-controlled, searchable surface. It
ships no articles of its own, and no role model of its own.

```bash
npm install @stonedogcode/howto
```

## Why articles describe themselves

The usual way to build an in-app documentation section is a central list: a file
that maps every article to a title, a place in the navigation, and an audience.
It works until it is ninety articles long. Adding an article becomes an edit in
three places, and the failure when they disagree is silent — the article is
simply not there, and looks exactly like an article nobody wrote.

So the article carries its own metadata:

```markdown
---
title: Inviting a teammate
slug: inviting-a-teammate
section: workspace
order: 20
summary: Adding and removing members of a workspace.
roles: [Admin, Support]
---

## Adding a member

…
```

Only `title` and `section` are required. `slug` defaults to the file's basename,
`order` to `0`. Anything malformed throws, naming the file — a default that
quietly puts an article in the wrong place is worse than a refusal.

## Loading articles

```ts
import { loadArticles } from "@stonedogcode/howto/node";

const articles = loadArticles("./content/how-to", { sectionFromDirectory: true });
```

Reads every `.md` under the directory, recursively, in a stable order. A separate
entry point, so a browser bundle never pulls `node:fs` in through the main
export.

`sectionFromDirectory` names each article's section after the directory it sits
in — but only when the article did not declare one itself, so moving a file
cannot silently re-section it. It is **off by default**: with it off, a missing
`section` is an error naming the file rather than a guess.

When one file in a hundred is malformed, the error names that file. That is the
whole reason this exists rather than being left to each consumer's own walk-and-
parse loop — the interesting behaviour is what happens to the bad file, and it
would otherwise be reimplemented differently every time.

## Arranging sections

The host declares the sections; articles slot themselves in by `section` and
`order`.

```ts
import { buildManifest, type HowToConfig } from "@stonedogcode/howto";

const config: HowToConfig = {
  sections: [
    { id: "getting-started", title: "Getting started" },
    {
      id: "admin",
      title: "Administration",
      children: [{ id: "security", title: "Security" }],
    },
  ],
};

const manifest = buildManifest(articles, config);
```

`buildManifest` throws if an article names a section that does not exist, if two
articles share a slug, or if a section id is declared twice. Use
`validateArticles` to collect every problem at once instead — fixing a hundred
articles one thrown error at a time is its own punishment.

## Access control is the host's

This package never models roles, levels, or scopes. Applications do not share one
role model, and pretending otherwise is how privilege leaks between scopes. It
asks the host one question:

```ts
interface HowToViewer {
  canSee(requiredRoles: string[] | undefined): boolean;
}
```

Implement it against whatever authorisation you already have:

```ts
const viewer: HowToViewer = {
  canSee: (roles) => (roles ? roles.some((r) => membership.hasRole(r, orgId)) : true),
};

const visible = filterManifest(manifest, viewer);
```

A `roleSetViewer({ roles })` helper is included for the plain case where an
article's `roles` list is simply checked against the roles the reader holds.

**Filter on the server, before the manifest reaches the browser.** Filtering only
in the UI ships every article's title, summary and body to a reader who may not
read them, where the network tab recovers the lot. `filterManifest` prunes the
slug index as well as the navigation, so a guessed URL cannot bypass the sidebar,
and it prunes a section whose every article is hidden — an empty section's title
still tells a reader that a subject exists which they are not entitled to know
about.

## Tables of contents

```ts
import { extractToc } from "@stonedogcode/howto";

const toc = extractToc(article.body); // [{ id, text, depth }, …]
```

`h2`–`h3` by default, and empty when there are fewer than two of them — a
one-entry table of contents saves no one a scroll and costs everyone the space
above the first paragraph.

Anchor ids come from [`github-slugger`](https://github.com/Flet/github-slugger),
the same slugger [`rehype-slug`](https://github.com/rehypejs/rehype-slug) uses, so
a link built from an entry resolves against the rendered heading — including the
`-1`, `-2` suffixes on repeated headings. The ids are computed in a different
pass from the one that renders the headings, and if the two disagree nothing
fails: the page just does not move when the link is clicked.

## Search

```ts
import { buildSearchIndex, search } from "@stonedogcode/howto";

const index = buildSearchIndex(articles); // parse once
const results = search(index, "sharing a link", viewer);
```

Every query word must appear somewhere in the article, so a second word narrows.
Titles outrank summaries, which outrank headings, which outrank prose. Code
blocks are excluded — searching documentation should not rank an article because
the word appeared in a sample payload.

**The viewer filter runs before matching, not after.** Matching first and hiding
afterwards still lets result counts, ranking and timing disclose that an article
the reader may not open exists and mentions their search term. A title is
content.

## Rendering

```tsx
import { HowToArticle, HowToNav, HowToSearch, renderArticle } from "@stonedogcode/howto";

<HowToNav manifest={visible} hrefFor={(a) => `/how-to/${a.meta.slug}`} activeSlug={slug} />
<HowToArticle article={article} />
```

`renderArticle` turns a body into React elements with anchored headings.
Raw HTML in an article is **dropped, not rendered** — articles are documentation,
and a pipeline that renders whatever markup an author pastes in is a
script-injection route with an authoring interface in front of it.

The renderer is style-agnostic. Pass `components` to substitute any element by
tag name:

```tsx
renderArticle(article.body, {
  components: { h2: MyHeading, a: MyLink, table: MyTable },
});
```

A component that replaces a heading **must spread its props** — the anchor id
arrives that way, and dropping it silently kills every table-of-contents link.

`HowToNav` and `HowToSearch` hold no viewer and perform no access check. They
render what they are handed, deliberately: the filtering has to happen on the
server, where a client cannot decline to run it. Compose them as
`filterManifest` → render, and `search(index, query, viewer)` → render.

## The `stonedog-style` presentation layer

A ready-made component map is available from a **separate entry point**:

```tsx
import { stonedogArticleComponents } from "@stonedogcode/howto/styled";

<HowToArticle article={article} components={stonedogArticleComponents} />
```

It is separate on purpose. The core package has no styling dependency; importing
this module is what opts you into Panda CSS and the design system, and a host
with its own components never loads it and never installs `stonedog-style`.
Colours come from the host's theme layer — the same custom properties any
`stonedog-style` consumer already provides.

If you use this entry point, then in your own `panda.config.ts`:

```ts
presets: [
  "@pandacss/preset-base",     // a `presets` array REPLACES the defaults —
  "@pandacss/preset-panda",    // omit these and the recipes lose their tokens
  stonedogStylePreset(),       // silently, with no build error
],
include: [
  "./node_modules/@stonedogcode/howto/src/**/*.{ts,tsx}",
  "../../node_modules/@stonedogcode/howto/src/**/*.{ts,tsx}",  // npm workspaces hoist
  "./node_modules/stonedog-style/src/**/*.{ts,tsx}",
  "../../node_modules/stonedog-style/src/**/*.{ts,tsx}",
],
```

**List both paths for each.** Which one exists depends on how your workspace
resolves, and a glob that matches nothing fails silently: Panda parses no
source, emits no rules, and the components still render with the class names.
The page is simply unstyled, with a green build. This package asserts its own
globs resolve to real files in a test, and yours should too.

## Development

```bash
npm install
npm run gate     # type-check, lint, test
```

The test suite runs Jest as ESM (`NODE_OPTIONS=--experimental-vm-modules`). The
whole markdown dependency chain is ESM-only, and the CommonJS path can load it
only through a `transformIgnorePatterns` allowlist that silently rots as the
dependency tree changes.

## Licence

Apache-2.0. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
