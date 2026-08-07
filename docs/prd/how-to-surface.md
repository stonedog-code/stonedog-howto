# PRD — A shared how-to surface

## Summary

Applications need a place that explains how their own features work, to their own
users, with their own access rules. Building that place is a solved problem that
keeps getting re-solved, differently, in each application — so the explanations
diverge in structure, navigation and quality even when the products are built by
the same people.

`@stonedogcode/howto` is that place, once: markdown articles that describe themselves,
arranged into sections the host declares, filtered by access rules the host owns,
with a per-article table of contents and search across the set.

## Goals

- **Adding an article is writing one file.** No central list to keep in step.
- **One surface, several applications.** The same navigation, search and
  table-of-contents behaviour everywhere, so a reader who has used one knows the
  next.
- **The article declares its own audience**, because the article is the thing
  being protected, and different applications name their roles differently.
- **Access control is enforceable on the server**, so restricted prose never
  reaches a browser that may not display it.
- **Content stays with the application.** The package holds mechanism, never
  prose.

## Non-goals

- **A role model.** The package does not define roles, levels, scopes, or a
  permission ladder. See "Access control", below.
- **A content management system.** Articles are files in the host's repository,
  reviewed and shipped like code.
- **A general-purpose markdown renderer.** The renderer serves documentation
  articles; it is not a CommonMark showcase.
- **Public documentation hosting.** The surface is in-application.

## Users and use cases

| Reader | Wants |
|---|---|
| An end user | To find how one feature works, quickly, and not to see documentation for features they do not have |
| An administrator | Operational articles for the parts of the product they administer, and nothing about parts they do not |
| An engineer on the product | Internal reference — architecture, processes, decision records — in the same place, gated to staff |

The distinguishing property is that **all three read from one set**, and which
articles exist is, for each of them, a different question.

## Functional requirements

### Article format

A markdown file with a YAML frontmatter block.

| Field | Required | Default | Meaning |
|---|---|---|---|
| `title` | yes | — | Heading and navigation label |
| `section` | yes | — | The section id it belongs to |
| `slug` | no | file basename | Unique, URL-safe identifier |
| `order` | no | `0` | Rank within the section; ties break on title |
| `summary` | no | — | One line under the title in listings and results |
| `roles` | no | — | Host role names that may read it |

A malformed field is an error naming the file, never a silent default. An article
that defaults into the wrong section is indistinguishable, to its author, from an
article that works.

`roles: []` is rejected specifically: it reads as "unrestricted" to an author and
means "nobody" to a membership check, and the article then disappears with
nothing to explain it.

### Arrangement

The host declares an ordered, nestable list of sections. Articles place
themselves. Building a manifest fails — loudly, at the host's build or boot — when

- an article names a section that does not exist (it would render nowhere),
- two articles share a slug (slugs are URLs),
- a section id is declared twice (ids place articles).

Validation is also available as a list, so a host can surface every problem at
once.

Empty sections are **kept**. Arrangement is the host's statement of how its
documentation is organised, and a section awaiting its first article is a
legitimate thing to declare.

### Access control

The package asks the host one question, per article:

```ts
canSee(requiredRoles: string[] | undefined): boolean
```

It supplies no role model of its own, and this is the central design decision
rather than an omission. Applications genuinely disagree about what a role is —
one has a global ordered ladder, another a set of named grants, another a role
held per organisation membership where a global role would leak the higher
privilege into the lower context. A package that picked one would be wrong for
the others in a way that is invisible until it has leaked something.

A set-membership helper is provided for hosts that need nothing more.

Filtering must:

- prune articles the reader may not see from navigation **and** from the
  slug index, so a guessed URL cannot bypass the sidebar;
- prune a section left with nothing visible — an empty section's title still
  discloses that a subject exists;
- run before search matching, not after, so result counts, ranking and timing
  cannot disclose a hidden article that mentions the reader's search term.

### Tables of contents

Every article offers a clickable table of contents linking to its own sections,
`h2`–`h3` by default, suppressed below two entries.

Anchor ids must match what the renderer emits. They are produced by the slugger
`rehype-slug` uses, including its duplicate-suffix behaviour, because the ids are
computed in a separate pass from rendering and a disagreement between the two
fails silently — the link is live, and the page simply does not move.

### Search

Across titles, summaries, headings and prose; excluding code blocks, so a sample
payload cannot rank an article. Every query word must appear, so adding a word
narrows. Ranking prefers titles, then summaries, then headings, then prose. Ties
break on title, so an identical query does not reshuffle its results.

Articles are parsed once into an index rather than per keystroke.

## Technical notes

- **Ships TypeScript source, not a bundle.** The rendering layer is styled with
  Panda CSS, which extracts styles by statically parsing source at the
  *consumer's* build; a pre-bundled distribution emits class names the consumer's
  Panda never generated a stylesheet for. Consumers transpile the package and add
  its `src` to their Panda `include` globs — listing both the local and the
  hoisted `node_modules` path, since which one exists depends on the consumer's
  workspace resolution and a glob that matches nothing fails silently.
- **A real YAML parser**, not a key/value scanner. The scanner is fine until the
  first article wants a list, or a colon inside a title — by which point the
  format is load-bearing across every article in every consuming application, and
  its bugs are indistinguishable from authoring mistakes.
- **A real markdown parser**, for the same reason, and because heading anchors,
  table-of-contents extraction and search text then come from one syntax tree
  rather than three hand-written passes that can disagree.
- **Tests run as ESM.** The markdown dependency chain is ESM-only; the CommonJS
  path can load it only through an allowlist that silently rots as the dependency
  tree changes.

## Rollout

1. **Article model, arrangement, access control, tables of contents, search.**
   No rendering. Usable today by a host with its own renderer, provided that
   renderer slugs headings the same way.
2. **The React layer** — markdown renderer with anchored headings, and the
   navigation, search and table-of-contents components built on `stonedog-style`.
3. **Adoption**, one application at a time, each landing after the release it
   depends on is published.

Applications whose articles are already markdown adopt cheaply. An application
storing article content as code needs its content converted to files first, and
that conversion is the bulk of its adoption cost.

## Open questions

- Whether section arrangement should also be expressible as a file the way
  articles are, for hosts that would rather not keep it in code.
- Whether search should offer a snippet with the match in context, or leave
  presentation entirely to the host.
