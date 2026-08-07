---
title: A file that overrides its directory
section: getting-started
order: 30
summary: This file sits in one directory and appears under another, on purpose.
---

On disk this file is `content/using-the-surface/where-this-article-lives.md`.
In the navigation it is under **Getting started**, because its frontmatter says
`section: getting-started` and a declared section beats the directory.

## Why the declaration wins

`sectionFromDirectory` only fills in a section that is **missing**. If the
directory always won, then moving a file — a rename, a tidy-up, a bulk
reorganisation — would silently re-file the article somewhere its author never
chose, with nothing failing to announce it.

So the rule is: the directory is a default, never an override.

## When to use each

Let the directory decide, for almost everything. Twelve directories mapping
one-to-one onto twelve sections is a real convenience at a hundred articles, and
it means adding an article is one file in one place.

Declare a section explicitly when the file's home on disk and its home in the
navigation genuinely differ — as here — and say why in the article, because the
next person to look for it will look in the directory it appears under.
