# PRD — Related content: a storage adapter, and a headless core

## Summary

Two articles can be about the same thing from different directions. Homebrew is
about macOS; macOS is about Homebrew. A reader who arrives at either should be
offered the other, and today this package has no way to say so — there is no
field, no API, and no validation for one article relating to another.

Every application that wanted it built something else, and the something-elses
share a defect: the association is *directed*, so making it mutual is a
convention somebody has to remember twice. A link that works from one side and is
invisible from the other is the failure mode, and nothing reports it.

This adds a **related-content graph behind a storage adapter**: zero-config out of
the box on a bundled SQLite file, and pointed at a host's own PostgreSQL, MySQL or
MariaDB by configuration when the host has one. Bidirectionality is guaranteed by
the *read*, not by the data, so one stored edge is visible from both articles.

It also restructures the repository into a **headless core with framework
bindings**, so a React host and an Angular host consume one implementation of the
graph, the parser and the schema rather than two that drift.

## Goals

- **An edge stored once is visible from both articles.** Symmetry is a property of
  the query, not of the author's diligence, and not of a second row.
- **Zero configuration is the default path.** Installing the package and building
  gives a working graph with no database to provision, no connection string, and
  no migration to run.
- **A host with its own database can use it**, without the package having an
  opinion about which one, and without every other consumer paying for the driver.
- **One core, several framework bindings.** The graph, the parser and the schema
  are written and tested once; React and Angular get idiomatic bindings over the
  same core.
- **Related content is access-controlled before it is returned.** A sidebar must
  never disclose the title of an article the reader may not open.
- **Rich bodies without ceasing to be data.** An article may collapse a section or
  embed a calculator, and must still be a string that can be stored in a row,
  searched, and synced by a portal that never executes it.

## Non-goals

- **Automatic relatedness.** No inferring edges from shared words, tags or
  co-citation. A suggestion that is merely word-adjacent is worse than none,
  because the reader cannot tell which kind they are being shown.
- **Weighted or typed edges.** No "strongly related", no "prerequisite of". Each is
  a different feature wearing this one's clothes, and each can be added later
  without breaking a plain edge.
- **Raw, unsanitised HTML.** An escape hatch that renders whatever an author
  pasted is a script-injection route with an authoring interface in front of it,
  and a flag does not change that.
- **An ORM, or a query builder.** The adapter surface is four methods and the
  statements are hand-written per dialect. A dependency that abstracts three
  dialects is larger than the three statements it replaces.
- **A visual editor for the graph.** `setRelations` exists so a host *can* build
  one. This package does not.

## Users and use cases

| Reader | Wants |
|---|---|
| Someone reading a topic site | The neighbouring topics, from wherever they landed — search and deep links mean the sidebar is often the only navigation they see |
| An administrator mid-task | The policy article governing the runbook they are following, without going back to the index |
| An engineer writing an article | To state a relationship once and have it appear on both articles |
| A host evaluating the package | To get a working surface from `npx howto build` without provisioning anything |
| An enterprise host | To keep the data in the database they already run, backed up and audited with everything else |

The distinguishing property is that **the graph is navigation for some hosts and a
garnish for others.** An application with sections and forty articles uses edges
as a footer. A topic site with a hundred and sixty-five flat pages has no
meaningful section tree, and the graph *is* the structure. The feature has to be
good enough for the second case.

## Functional requirements

### The storage contract

One interface, framework-agnostic and dialect-agnostic:

```ts
export interface HowtoStorageAdapter {
  initialize(): Promise<void>;
  getRelatedArticleIds(articleId: string): Promise<string[]>;
  setRelations(articleId: string, relatedIds: string[]): Promise<void>;
  close?(): Promise<void>;
}
```

`getRelatedArticleIds` returns **ids only**. Titles, summaries and audiences stay
where they already are — in the article files — and core joins them against the
manifest before anything is rendered. Duplicating article metadata into the store
would create a second copy that can disagree with the file, which is the class of
bug this feature exists to remove rather than to add.

### The schema

```sql
CREATE TABLE IF NOT EXISTS article_relations (
  source_id VARCHAR(191) NOT NULL,
  target_id VARCHAR(191) NOT NULL,
  PRIMARY KEY (source_id, target_id),
  CHECK (source_id <> target_id)
);

CREATE INDEX IF NOT EXISTS idx_article_relations_target
  ON article_relations (target_id);
```

- **The composite primary key is the missing constraint.** The implementation this
  replaces has no unique constraint at all, which is why its data migrations carry
  `NOT EXISTS` guards around every insert. Here a repeated edge is rejected by the
  database rather than guarded against by each caller.
- **The index on `target_id` is load-bearing**, not an optimisation. The reverse
  half of the read below has no other access path, and without it every sidebar
  render is a full scan of the second branch.
- **`VARCHAR(191)`, not `VARCHAR(255)`.** Under `utf8mb4` on older InnoDB row
  formats the index-prefix limit is 767 bytes, and 255 four-byte characters
  exceeds it — a composite key of two such columns fails to create on exactly the
  MySQL and MariaDB versions an enterprise host is most likely to be running. 191
  is the largest length that is safe everywhere, and slugs are far shorter.
- **The `CHECK` removes self-edges at the source**, so no read has to filter the
  article out of its own suggestions. Worth knowing: MySQL only enforces `CHECK`
  from 8.0.16 and MariaDB from 10.2.1; earlier versions parse and ignore it, so
  the adapter validates it in code as well rather than trusting the engine.

### The read guarantees symmetry

```sql
SELECT target_id AS related_id FROM article_relations WHERE source_id = :id
UNION
SELECT source_id AS related_id FROM article_relations WHERE target_id = :id;
```

**This is the design decision the whole feature turns on.** Storing A → B makes
the connection visible from both A and B, because the read looks down both
columns. There is no reverse row to insert, so there is no reverse row to forget;
and a deletion cannot leave the relationship half-alive, because there was only
ever one row.

`UNION` rather than `UNION ALL`: an edge stored in both directions by a host that
did not know it was unnecessary collapses to one result instead of appearing
twice.

Ordering is applied by core after the join with the manifest, by title, so a
sidebar never reshuffles because of an unrelated write.

### Where edges come from

The store is the runtime source. It is populated from either or both of:

- **Frontmatter.** A new optional `related` field, validated like every other
  field. This keeps an association reviewable in the pull request that creates it,
  next to the prose it belongs to.

  ```markdown
  ---
  title: Homebrew
  section: tooling
  roles: [Public]
  related: [mac, linux]
  ---
  ```

  Consistent with `roles`, a bare string is accepted as a one-element list; an
  empty list is rejected naming the file; self-reference is rejected.

- **A bulk edge map**, for hosts that curate in clusters. "Everything in the React
  ecosystem relates to everything else in it" is one sentence and several hundred
  edges, and spreading those across a hundred files makes the intent unreadable
  and the maintenance quadratic.

`howto build` reads both, unions them, validates them, and writes the result
through `setRelations`. A host that has no files and edits the store directly —
an authoring UI — simply skips that step; the read path is identical either way.

### Validation

`validateArticles` gains one problem kind, at `error` severity:

- **`unknown-related-slug`** — an edge naming a slug no article provides. It names
  the article, the missing slug, and the source file.

`error`, not `warning`, and deliberately unlike `missing-roles`. A missing
audience has a correct and safe rendering; a dangling edge renders as an empty
suggestion or a dead link, which reads as a broken site rather than as an
incomplete article. Renames are the ordinary way this breaks, and a rename is
exactly the moment a build should object.

A store can hold an edge to an article that no longer exists — nothing stops a
host deleting a file. So the join against the manifest drops unresolvable ids at
read time as well, and `howto build` reports them. Failing the render because the
data is stale would take a working page offline over a suggestion.

### Access control

The filter runs in **core**, between the store and every binding — never in a
framework package. `relatedFor(slug, viewer)` is the only public read path, and it
applies the host's `HowToViewer` before returning anything.

Placing it in core rather than in each binding is deliberate: a check that each
framework package must remember to perform is a check that one of them eventually
does not, and the failure discloses titles rather than raising an error. A related
list is a list of titles, and a title is content.

An article may declare an edge to one it cannot itself entitle. That is not an
error — the relationship is still true; it simply does not render for that reader.

### The default adapter

`SqliteAdapter`, writing `.howto/data.db`, chosen when nothing else is
configured. `initialize()` creates the schema if it is absent. Nothing to
provision, nothing to configure, and the file is small enough to be a build
artifact.

### External adapters

`PostgresAdapter`, `MySqlAdapter` and `MariaDbAdapter`, selected by configuration:

```ts
// howto.config.ts
export default {
  storage: process.env.DATABASE_URL
    ? new PostgresAdapter({ connectionString: process.env.DATABASE_URL })
    : new SqliteAdapter({ filePath: "./.howto/data.db" }),
};
```

**External adapters do not run DDL.** `initialize()` on an external adapter
*verifies* the schema and reports precisely what is missing; it does not create
anything. Three reasons, and they compound:

- An enterprise application user usually holds no DDL rights, by policy. An
  adapter that assumes otherwise fails at startup with a permissions error, in
  production, at the least convenient moment.
- Auto-DDL and the shipped migrations would be two mechanisms for one schema, and
  the day they disagree is a day nobody planned for.
- Schema changes in a database somebody else owns are their change to review, not
  ours to perform on connect.

So `/migrations` ships raw, per-dialect SQL for the external adapters, and SQLite
— a file this package owns outright — keeps its `CREATE TABLE IF NOT EXISTS`.

Each external adapter accepts a **schema or table prefix**, defaulting to an
isolated namespace so the tables cannot collide with the host's own. This is not
one mechanism: PostgreSQL has real schemas (`stonedog_howto.article_relations`);
MySQL and MariaDB do not — there a schema *is* a database — so isolation is a
table prefix or a dedicated database, and the option is named accordingly per
adapter rather than pretending to a portability that does not exist.

### HTML in bodies

Raw HTML is currently dropped. That is right for a surface ingesting articles it
did not author, and wrong for one whose articles are written and reviewed in the
same repository as the code.

`renderArticle` gains a mode:

| Mode | Behaviour |
|---|---|
| `"drop"` | Today's behaviour, and the **default**, so no existing consumer changes |
| `"sanitize"` | Parsed and sanitised against an allowlist — `<details>`/`<summary>`, description lists, `<kbd>`, `<figure>`, inline emphasis. Scripts, event-handler attributes and `javascript:` URLs are removed |

There is no third mode.

`<details>` alone is most of the requirement: a collapsible section is the
commonest structural device in long technical articles, and markdown has no syntax
for it.

The sanitiser must be tested **in both directions**. A test asserting `<details>`
survives passes just as well against a renderer that strips nothing, and a test
asserting `<script>` is removed passes against one that strips everything. Only
the pair says anything.

### Naming a component

Sanitised HTML cannot express a timezone converter, a diff viewer or a schema
explorer. Those are programs, and an article containing a program has stopped
being data.

An article may instead **name** one:

```markdown
:::widget{name="tz-converter"}
```

resolved against a registry the host supplies. An unknown name is a build error,
for the same reason an unknown section is. Each framework binding supplies its own
registry, and the same article renders an Angular component in one host and a
React one in another — which is only possible because the body names a component
rather than containing it.

## Package structure

A single repository, organised as npm workspaces with a headless core and thin
framework bindings. **Not a second repository for Angular**: separate repositories
produce schema drift and two markdown parsers that disagree, and the disagreement
surfaces as an article rendering differently in two products.

```
stonedog-howto/
├── packages/
│   ├── core/       @stonedogcode/howto-core
│   │   ├── src/storage/   adapters, schema, per-dialect statements
│   │   ├── src/graph/     symmetric resolution, manifest join, viewer filter
│   │   └── src/parser/    frontmatter, markdown AST, TOC, search index
│   ├── react/      @stonedogcode/howto-react
│   │   ├── src/components/  <RelatedContent />, nav, search, article
│   │   └── src/hooks/       useRelatedArticles()
│   └── angular/    @stonedogcode/howto-angular
│       ├── src/components/  <howto-related-content>
│       └── src/services/    HowtoService (signals)
```

Core has **no framework dependency and no driver dependency**. Each database
driver is an optional peer of its own adapter entry point, so a host that never
touches PostgreSQL never installs `pg`, and a host on SQLite alone never compiles
a native module it does not use.

### What each binding owns, and what it may not

A binding owns presentation and framework idiom. It **may not** own the viewer
filter, the symmetric read, or slug resolution — those live in core precisely so
that two bindings cannot answer the same question differently.

The two bindings are not symmetric in one respect, and it is worth naming rather
than discovering: the React components are styled with Panda CSS, which extracts
by statically parsing source at the consumer's build. That mechanism has no
Angular equivalent. `@stonedogcode/howto-angular` therefore ships plain CSS driven
by custom properties, reading the same theme variables, and is styled by the host
overriding those rather than by a preset.

### This is a breaking change, and needs a migration path

`@stonedogcode/howto` becomes `@stonedogcode/howto-core` plus a binding, and there
are live consumers today. The rename ships as **1.0**, with the existing package
name retained for one major version as a meta-package that re-exports core and
react — so no consumer is forced to move in the same release that gains the
feature. Consumers migrate on their own schedule; the shim is removed at 2.0, and
its deprecation notice says so with a version rather than "soon".

## Technical notes

- **`better-sqlite3` and `libsql` are native modules.** They need prebuilds per
  platform and Node ABI, and they cannot be bundled into an edge or serverless
  runtime. Keeping the SQLite adapter behind its own entry point with the driver as
  an optional peer means this constrains only the hosts that choose it — but any
  host deploying to a serverless target should choose an external adapter, and the
  README should say so where the default is documented, not in a footnote.
- **The default SQLite file is a build artifact, not runtime state.** These
  applications deploy as single small containers with ephemeral filesystems: a
  `.howto/data.db` written at runtime is discarded on the next deploy. Generated by
  `howto build` and baked into the image read-only, it is exactly right. A host
  that wants runtime writes — an authoring UI — needs an external adapter or a
  volume, and the README must say which, because the failure is silent: writes
  appear to succeed and vanish at the next deployment.
- **`setRelations` replaces an article's edge set; it does not merge.** Merge
  semantics make deletion impossible to express, and a build that cannot remove an
  edge diverges from the files a little more on every run.
- **Both stored directions are permitted and harmless.** The primary key prevents a
  duplicate of the *same* ordered pair, not the mirrored one, and `UNION` collapses
  the mirror at read time. Canonicalising the order on write was considered and
  rejected: it makes `setRelations(a, …)` write rows keyed on other articles, so
  two concurrent builds can interleave into a set neither intended.
- **The e2e tier must exercise a real external adapter**, not only SQLite. A
  dialect difference — `ON CONFLICT` versus `INSERT IGNORE`, identifier quoting,
  `CHECK` enforcement — is invisible to a suite that only ever runs the dialect
  that has no such difference.
- **Sanitisation runs after parsing, not before.** Filtering the markdown source as
  text is defeated by the first entity-encoded payload.

## Rollout

Each stage is independently useful and independently releasable.

1. **The workspace split.** `core` and `react`, with `@stonedogcode/howto`
   retained as a re-exporting shim. No feature change, so the diff is reviewable
   as a move and every existing consumer is unaffected.
2. **The storage contract and the SQLite adapter** — interface, schema, the `UNION`
   read, `howto build`.
3. **Authoring sources** — `related` frontmatter, the bulk edge map,
   `unknown-related-slug` validation, and the core read path with the viewer
   filter and manifest join. `<RelatedContent />` in the React binding.
4. **Adoption by an application that already fakes it.** The first host to convert
   hand-written "related" prose into declared edges is the design's honest test: if
   a dozen real associations do not express cleanly, the field is wrong, and this
   is the cheapest moment to learn it.
5. **External adapters** — PostgreSQL, MySQL, MariaDB, with `/migrations` and the
   verify-don't-create rule, and the e2e tier running against at least one.
6. **The Angular binding** — `HowtoService`, `<howto-related-content>`, and the
   custom-property styling.
7. **Sanitised HTML mode**, default unchanged.
8. **Component directives**, with the registry supplied per binding.
9. **Adoption by an application whose articles are code.** The original PRD
   predicted this: *"an application storing article content as code needs its
   content converted to files first, and that conversion is the bulk of its
   adoption cost."* That remains true, and the conversion does not depend on the
   host's framework — markdown articles are framework-neutral. With an Angular
   binding available, the conversion can happen **before** any framework change,
   and the framework change then carries no documentation risk at all.
10. **Retiring the replaced implementation** in any application whose edges the
    package now serves.

## Open questions

- **Whether an edge may be one-way on purpose.** "See also" is sometimes genuinely
  asymmetric — a reference article may not want to advertise every tutorial citing
  it. The `UNION` read forbids this by construction. If it is wanted it is a second
  table or a discriminator column, never a weakening of the symmetric read, because
  the moment one mechanism means both things neither is checkable.
- **Whether MDX belongs in the parser.** Naming a component covers the known cases
  and keeps a body inert text a portal can store in a row and search. MDX would end
  that property and require a bundler step in every consumer. It stays out until
  something needs what naming cannot express.
- **Whether cross-scope edges are meaningful.** A portal serving several
  repositories scopes slugs per repository, so an edge between two applications
  needs a qualified id and a decision about entitlement across scopes. Same-scope
  only until something wants otherwise.
- **Whether inline annotation inside fenced code blocks is expressible.** One
  candidate corpus uses several hundred inline comment components *inside* code
  blocks, which fenced markdown cannot represent. Either those become comments in
  the code itself, or fenced blocks need an annotation syntax — a markdown-format
  question large enough to deserve its own decision rather than being settled
  inside a migration.
