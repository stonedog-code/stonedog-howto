---
title: Writing an article
order: 20
summary: The frontmatter fields, and what each one decides.
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
- **`roles`** — who may read it. Omit it and the viewer decides the default
  audience.

## When you get it wrong

Nothing is guessed. A malformed article throws an error naming the file, because
an article silently filed in the wrong section is worse than an article that
refuses to load — the second one you find immediately.
