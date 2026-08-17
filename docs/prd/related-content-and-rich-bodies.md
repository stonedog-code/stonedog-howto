# PRD — Related content, and bodies richer than prose

## Summary

Two articles can be about the same thing from different directions. Homebrew is
about macOS; macOS is about Homebrew. A reader who arrives at either should be
offered the other, and today this package has no way to say so — there is no
field, no API, and no validation for one article relating to another.

Every application that wanted it has therefore built something else, and the
something-elses share a defect: the association is *directed*, and making it
mutual is a convention somebody has to remember twice. A link that works from one
side and is invisible from the other is the failure mode, and nothing reports it.

This adds a **related-content graph** whose edges are declared in the repository
and made symmetric by construction, and — because the applications that most want
a graph also have the richest articles — an **opt-in sanitised HTML mode** and a
way for an article to *name* a host component it does not contain.

## Goals

- **An edge declared once is an edge in both directions.** Symmetry is a property
  of the algorithm, not of the author's diligence.
- **A wrong edge fails the build, naming the file** — the same treatment `section`
  already gets. An association pointing at nothing is indistinguishable, to a
  reader, from an association nobody wrote.
- **Edges are reviewable in the pull request that creates them.** They travel with
  the article, like everything else this package treats as content.
- **Related content is access-controlled before it is returned.** A sidebar must
  never disclose the title of an article the reader may not open.
- **Rich bodies without ceasing to be data.** An article may collapse a section
  or embed a calculator, and must still be a string that can be stored in a row,
  searched, and synced by a portal that never executes it.

## Non-goals

- **A database.** See "Where edges live", below. This is the decision most
  worth reading, because the obvious answer is the wrong one here.
- **Automatic relatedness.** No inferring edges from shared words, tags, or
  co-citation. A suggested article that is merely word-adjacent is worse than no
  suggestion, and the reader cannot tell which kind they are being shown.
- **Weighted or typed edges.** No "strongly related", no "prerequisite of". Every
  one of those is a different feature wearing this one's clothes, and each can be
  added later without breaking a plain edge.
- **Raw, unsanitised HTML.** An escape hatch that renders whatever an author
  pasted is a script-injection route with an authoring interface in front of it,
  and a flag does not change that.
- **MDX.** See "Naming a component", below.

## Users and use cases

| Reader | Wants |
|---|---|
| Someone reading a topic site | The neighbouring topics, from wherever they landed — search and deep links mean the sidebar is often the only navigation they see |
| An administrator mid-task | The policy article that governs the runbook they are following, without going back to the index |
| An engineer writing an article | To state a relationship once, next to the prose, and have it appear on both articles |
| A maintainer | To be told at build time that an article now points at something that was renamed or deleted |

The distinguishing property is that **the graph is navigation for some hosts and a
garnish for others.** An application with sections and forty articles uses edges
as a footer. A topic site with a hundred and sixty-five flat pages has no
meaningful section tree at all, and the graph *is* the structure. The feature has
to be good enough for the second case.

## Functional requirements

### Declaring an edge

A new optional frontmatter field, alongside the existing six:

| Field | Required | Type | Default | Meaning |
|---|---|---|---|---|
| `related` | no | string[] | — | Slugs of articles related to this one, in both directions |

```markdown
---
title: Homebrew
section: tooling
roles: [Public]
related: [mac, linux]
---
```

Consistent with `roles`, a bare string is accepted as a one-element list, and an
empty list is **rejected** naming the file — it states a relationship set that
cannot be distinguished from having written nothing, and its effect is invisible.

Self-reference is rejected. It is always a copy-paste error and it would render
an article as its own suggestion.

### Building the graph

```ts
const graph = buildRelatedGraph(articles, { edges });
graph.for("mac"); // → the Homebrew article, though mac.md never mentioned it
```

The graph is the **symmetric closure** of every declared edge. If `homebrew`
declares `mac`, then `mac` relates to `homebrew`, with nothing written in
`mac.md`. Declaring it on both sides is allowed and is not a duplicate — the union
is a set.

This is the requirement the whole feature turns on. Both existing implementations
store a directed pair and rely on somebody inserting the reverse one; a
half-inserted pair is a link that works on one page, is absent on the other, and
is reported by nothing. Making the closure the only way to read the graph removes
the failure rather than documenting it.

Ordering is stable and by title, so an unrelated edit elsewhere never reshuffles a
sidebar.

### Validating it

`validateArticles` gains one problem kind, at `error` severity:

- **`unknown-related-slug`** — an edge naming a slug no article in the set
  provides. It names the article, the missing slug, and the source file.

`error`, not `warning`, and deliberately unlike `missing-roles`. A missing
audience has a correct and safe rendering; a dangling edge does not — it renders
as an empty suggestion or a dead link, which reads to a reader as a broken site
rather than as an incomplete article. Renames are also the ordinary way this
breaks, and a rename is exactly the moment a build should object.

### Bulk edges

Some hosts curate relationships in clusters rather than per article: "everything
in the React ecosystem relates to everything else in it" is one sentence and
several hundred edges. Spreading those across a hundred files makes the intent
unreadable and the maintenance quadratic.

`buildRelatedGraph` therefore accepts an optional edge map:

```ts
buildRelatedGraph(articles, { edges: { homebrew: ["mac", "linux"] } });
```

Both sources are unioned into the same symmetric closure and validated
identically. Neither is primary: an application may use one, the other, or both,
and the graph cannot tell which side an edge arrived from.

The map is a plain object, which the host may keep in any form it likes — a
committed JSON file, a generated one, a constant in code. This package does not
read files for it, so it does not care.

### Access control

The graph is filtered through the host's `HowToViewer` **before** it is returned,
exactly as search already is. A related list is a list of titles, and a title is
content: returning one the reader may not open discloses both that the article
exists and what it is about.

An article may declare an edge to an article it cannot itself entitle. That is not
an error — the two articles have different audiences and the relationship is still
true; it simply does not render for that reader.

### Rendering

A `RelatedArticles` component, and a headless `relatedFor(slug, viewer)` for hosts
with their own presentation. Both return nothing when the filtered list is empty,
rather than an empty heading — a "Related" header with nothing under it tells a
reader that something was hidden from them.

### HTML in bodies

Raw HTML is currently dropped. That is right for a surface that ingests articles
it did not author, and wrong for one whose articles are written and reviewed in
the same repository as the code.

`renderArticle` gains a mode:

| Mode | Behaviour |
|---|---|
| `"drop"` | Today's behaviour, and the **default**, so no existing consumer changes |
| `"sanitize"` | Parsed and sanitised against an allowlist — `<details>`/`<summary>`, description lists, `<kbd>`, `<figure>`, and inline emphasis. Scripts, event-handler attributes, and `javascript:` URLs are removed |

There is no third mode.

`<details>` alone is the requirement behind most of this: a collapsible section is
the commonest structural device in long technical articles and markdown has no
syntax for it.

The sanitiser must be tested **in both directions**. A test asserting that
`<details>` survives passes just as well against a renderer that strips nothing,
and a test asserting that `<script>` is removed passes against one that strips
everything. Only the pair says anything.

### Naming a component

Sanitised HTML cannot express a timezone converter, a diff viewer, or a
schema explorer. Those are programs, and an article that contains a program has
stopped being data.

An article may instead **name** one:

```markdown
:::widget{name="tz-converter"}
```

resolved against a registry the host supplies. An unknown name is a build error,
for the same reason an unknown section is.

**This is deliberately not MDX.** MDX would require a bundler step in every
consumer and would end the property the portal depends on: that an article body
is inert text which can be read once, stored in a row, searched, and rendered by
something that never executes it. Naming a component keeps the body inert and puts
the executable part where it already lives — in the host.

## Where edges live

**In the repository. Not in a database.** A bundled file database was the proposed
design and was considered seriously, because the goal behind it is right: no
consumer of this package should have to run infrastructure to use it. The
conclusion is that the goal is better served one step earlier — by not having a
data store at all.

Four reasons, in the order they would bite:

- **It reintroduces the thing this package exists to remove.** The first goal in
  the original PRD is "adding an article is writing one file — no central list to
  keep in step", and its non-goals name "a content management system: articles are
  files in the host's repository, reviewed and shipped like code". A relations
  table outside the repository is that central list, and it cannot travel in the
  pull request that adds the article it describes.
- **Drift becomes undetectable.** With edges in the repository, deleting an
  article breaks the build and names the file. With edges in a database, the same
  deletion leaves a dangling row that no build, no review and no test can see —
  found, if ever, by a reader.
- **The filesystem is not durable where these applications run.** Every consuming
  site is a single small container. A database file written at runtime is
  discarded on the next deployment; one baked into the image is a read-only
  artefact that a build step could have produced as JSON, without a driver.
- **The dependency reaches every consumer.** This package ships TypeScript source
  so the consumer's Panda build can parse it. A driver imported from `src/` is
  therefore parsed by every consumer's build, including the ones that wanted
  nothing but markdown.

### The door that stays open

Runtime-editable relationships are a real requirement — an authoring UI, or a
portal that lets a reader link two articles, cannot ship edges in a repository.
So the graph is defined against an interface rather than against files:

```ts
export interface RelatedStore {
  edgesFor(slug: string): Promise<string[]>;
}
```

The core package defines the interface and one implementation, which reads the
frontmatter and the edge map. **No driver, for any engine, ships in core.** A SQL
implementation is a separate package with its own dependencies, its own
migrations, and its own answer to schema isolation — which is not one answer:
PostgreSQL and SQL Server have schemas, while MySQL and MariaDB do not, so
isolation there means a separate database or a table prefix. That divergence is
itself an argument for keeping it out of a package whose selling point is that it
needs no configuration.

## Technical notes

- **The closure is computed once, at manifest build**, not per request. A host
  that rebuilds its manifest per request has a different problem.
- **Slugs are the identity**, as everywhere else in this package. Hosts that scope
  slugs more narrowly than globally — a portal serving several repositories, where
  two applications may both document "getting-started" — get **same-scope edges
  only**. A cross-scope edge needs a qualified reference and a decision about what
  the reader is entitled to across scopes, and neither should be invented before
  something wants it.
- **Sanitisation runs after parsing, not before.** Filtering the markdown source
  as text is defeated by the first entity-encoded payload.
- **The directive syntax needs a remark plugin**, which is one dependency in a
  chain this package already carries end to end.

## Rollout

Each stage is independently useful and independently releasable.

1. **The graph** — `related` frontmatter, symmetric closure, `unknown-related-slug`
   validation, viewer filtering, `RelatedArticles`. A minor release.
2. **Bulk edges** — the external edge map, unioned under the same rule.
3. **Adoption by an application that already fakes it.** The first host to convert
   hand-written "related" prose into declared edges is the design's honest test:
   if a dozen real associations do not express cleanly, the field is wrong and
   this is the cheapest moment to learn it.
4. **Sanitised HTML mode**, default unchanged.
5. **Component directives**, with the registry supplied by the host.
6. **Adoption by an application whose articles are code.** The original PRD
   predicted this: *"an application storing article content as code needs its
   content converted to files first, and that conversion is the bulk of its
   adoption cost."* That remains true, and the conversion does not depend on the
   host's framework — markdown articles are framework-neutral, so the content
   conversion can and should happen **before** any framework change, not after it.
7. **Retiring the replaced implementation.** An application whose edges are now
   generated from its repository is storing a second copy of something version
   control already knows.

## Open questions

- **Whether an edge may be one-way on purpose.** "See also" is sometimes genuinely
  asymmetric — a reference article does not want to advertise every tutorial that
  cites it. The symmetric closure forbids this by design. If it turns out to be
  wanted, it is a second field rather than a weakening of the first, because the
  moment one field means both things, neither is checkable.
- **Whether the graph belongs in search ranking** — an article that many others
  relate to is plausibly a better result, and equally plausibly just an old one.
- **Whether inline annotation inside fenced code blocks is expressible.** One
  candidate corpus uses several hundred inline comment components *inside* code
  blocks, which fenced markdown cannot represent. Either those become comments in
  the code itself, or fenced blocks need an annotation syntax — and that is a
  markdown-format question large enough to deserve its own decision rather than
  being settled inside a migration.
