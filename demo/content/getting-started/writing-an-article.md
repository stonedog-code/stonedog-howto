---
title: Writing an article
order: 20
summary: The frontmatter fields, and what each one decides.
roles: [Guest, User, Admin]
---

An article is a markdown file with a YAML frontmatter block. This file's own
frontmatter is four lines long:

```yaml
---
title: Writing an article
order: 20
summary: The frontmatter fields, and what each one decides.
---
```

## Where is `section`?

Normally required — but this demo loads articles with `sectionFromDirectory`
turned on, so an article that does not name a section takes the name of the
directory it sits in. This file lives in `content/getting-started/`, so its
section is `getting-started`.

The option only fills in a **missing** section. An article that declares one
keeps it wherever the file is moved to, which is why the injection cannot
silently re-file someone's article.

## The fields

- **`title`** — required. The heading, and the label in the navigation.
- **`section`** — required unless `sectionFromDirectory` supplies it. Must match
  a section id the host declared, or the build throws naming this file.
- **`slug`** — defaults to the filename without its extension. Unique across the
  whole set.
- **`order`** — rank within the section, ascending. Defaults to `0`. Ties break
  on title, so two articles at the same rank still come out in a stable order
  rather than in whatever order the filesystem handed them over.
- **`summary`** — one line, shown under the title in listings and search results.
- **`roles`** — **do not omit this.** Who may read the article, as a list of
  names the host understands. A reader holding **any one** of them may read it;
  it is a union, never an intersection.

## `roles` is the one you must not forget

The parser accepts an article without it, and then every viewer this package
ships refuses to show that article to anybody. That is not an oversight — it is
the point.

Silence is not "everyone". An article naming no audience has said *nothing*, and
the usual reason is that whoever wrote it forgot. If silence meant "everyone",
the one article nobody finished would be the one article everybody could read —
and no reader would ever report it, because nobody complains about being shown
too much. Denying instead makes the mistake visible: the article vanishes,
somebody asks where it went, and the frontmatter gets fixed.

`validateArticles` reports each one as a `missing-roles` warning naming the file,
so they can be counted rather than stumbled upon. *An article that forgot its
roles* in this section is a live example — and unless you tick the switch in the
header, you cannot open it.

## When you get it wrong

Nothing is guessed. A malformed article throws an error naming the file, because
an article silently filed in the wrong section is worse than an article that
refuses to load — the second one you find immediately.
