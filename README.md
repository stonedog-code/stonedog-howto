# stonedog-howto

A how-to documentation surface for applications.

Articles are markdown files that **describe themselves**. This package turns a
directory of them into an arranged, access-controlled, searchable surface. It
ships no articles of its own, and no role model of its own.

```bash
npm install stonedog-howto
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

## Arranging sections

The host declares the sections; articles slot themselves in by `section` and
`order`.

```ts
import { buildManifest, type HowToConfig } from "stonedog-howto";

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
import { extractToc } from "stonedog-howto";

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
import { buildSearchIndex, search } from "stonedog-howto";

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

This release covers the article model, arrangement, access control, tables of
contents and search. The React rendering layer — the markdown renderer with
anchored headings, and the navigation, search and table-of-contents components
built on [`stonedog-style`](https://github.com/stonedog-code/stonedog-style) — is
the next release.

`extractToc`, `extractHeadings` and `extractPlainText` are usable with any
renderer today, provided it slugs headings the same way.

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
