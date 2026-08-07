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

Anything malformed throws, naming the file — a default that quietly puts an
article in the wrong place is worse than a refusal.

## The article format

A file is frontmatter, then markdown. The frontmatter is a YAML block delimited
by `---` on its own line at the very start of the file; everything after the
closing delimiter is the body, and the body may be empty.

| Field | Required | Type | Default | What it decides |
| --- | --- | --- | --- | --- |
| `title` | **yes** | string | — | The heading, and the label in navigation and search results. Not taken from a `#` in the body: an article is listed by title, so the title has to exist as data, and reading it from the body as well would give an article two titles that can disagree. |
| `section` | **yes**¹ | string | — | Which section the article belongs to. Must match a section `id` the host declared, or `buildManifest` throws naming the file. |
| `slug` | no | string | the filename without its extension, **lowercased** | The article's identifier, unique across the whole set. Two articles sharing one is an error, not a last-one-wins. Must match `^[a-z0-9]+(-[a-z0-9]+)*$` — it appears in URLs. |
| `order` | no | number | `0` | Rank within the section, ascending. Ties break on title, so equal ranks still come out in a stable order rather than in whatever order the filesystem offered. |
| `summary` | no | string | — | One line under the title in listings and search results. Ranked below the title and above headings when searching. Blank is treated as absent. |
| `roles` | no | string[] | — | Who may read it. See below. |

¹ Unless `sectionFromDirectory` is on, which supplies it from the directory.

The default slug is lowercased because filename case is a local convention and a
slug is a URL. An explicit `slug` is still validated strictly against the pattern
above; only the bare-filename default is forgiving. Two filenames differing only
in case collapse to one slug, and that is reported as a duplicate naming both
files rather than silently losing one.

**Keys the package does not know are ignored, not rejected.** A typo'd `sumary`
does nothing, quietly. Worth knowing when an article is not behaving as its
frontmatter appears to say.

### `roles`, precisely

`roles` is a **set**, not a level. The package never interprets a role name; it
hands the list to the host's `canSee` and does as it is told.

- **Omitted** — the article states no requirement, and the *viewer* decides
  whether that means everyone or nobody. `roleSetViewer`'s `seesUnrestricted`
  option is that decision, and it defaults to "everyone".
- **A list of names** — readable by a reader holding **any one** of them. It is
  a union, never an intersection: there is no way to express "Admin *and*
  Auditor" in the article, because a requirement that two roles must be held
  together is an authorisation rule and belongs in the host's `canSee`, where
  the host can see the whole subject rather than one article's list.
- **A bare string** (`roles: Facility Admin`, unquoted and unbracketed) is
  accepted as a one-element list. It is a natural mistake and an unambiguous
  one.
- **An empty list** (`roles: []`) is **rejected**, naming the file. It would mean
  "no role may see this", which is never what an author intends, and its effect
  — the article silently disappearing — is invisible once rendered. Omit the
  field to leave the audience to the host.

The names are the *host's* role names. Different applications name their roles
differently and that is expected: the article is the right place for the
requirement because the article is the thing being protected, and the host is
the right place for the interpretation because the host is the thing that knows
who is reading.

## See it running

```bash
npm install
npm run dev     # → http://localhost:5174
```

[`demo/`](./demo) is a working how-to built from seven markdown articles in
three directories, with Guest / User / Admin audiences and a switcher to
impersonate each. Switching to Guest visibly removes the administration section,
and the `/api/howto` response for that viewer does not contain its articles —
which is the package's central claim, arranged so you can check it rather than
take it on trust.

It runs against this repository's `src/`, not the published package, so it is
also the fastest way to see a change you are making. It is not published: `files`
below ships `src/` alone.

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
