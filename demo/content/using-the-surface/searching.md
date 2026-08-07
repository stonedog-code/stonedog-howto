---
title: Searching the how-to
order: 10
summary: How results are matched and ranked, and what is deliberately left out.
roles: [Guest, User, Admin]
---

This article names all three roles, so everyone can read it — but it says so
explicitly rather than by omission. The distinction matters to a host that
configures `seesUnrestricted: false`, where an article with no `roles` is
readable by nobody.

Try the search box in the sidebar.

## Matching

Every word of the query must appear somewhere in the article, so a second word
narrows rather than widens. Searching `role` finds several articles; searching
`role filtering` finds fewer.

## Ranking

Titles outrank summaries, which outrank headings, which outrank prose. A word in
the title is a much stronger signal that the article is *about* that word than
the same word buried in a paragraph.

## What is excluded

**Code blocks.** Searching documentation should not rank an article highly
because the word happened to appear in a sample payload. This paragraph mentions
`section` in prose; the YAML block in *Writing an article* mentions it too, and
only this one counts.

## The ordering that matters

The viewer filter runs **before** matching, not after. Matching first and hiding
the forbidden results afterwards still lets the result count, the ranking of
what remains, and the time taken disclose that an article exists which you may
not open and which mentions your search term.

A title is content. So is the fact that something matched.
