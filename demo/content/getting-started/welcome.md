---
title: Welcome
order: 10
summary: What this demo is showing you, and how to read it.
roles: [Guest, User, Admin]
---

This article names all three roles, so every viewer can read it. Switch the
viewer in the header and watch this one stay put while others come and go.

## What you are looking at

A how-to surface built entirely from a directory of markdown files. Nothing
here is registered in a central list: each article says what it is called, where
it belongs, and who may read it, in its own frontmatter.

The demo's dev server reads `demo/content`, arranges it, and filters it for the
viewer you have chosen — then sends the result to this page.

## The three viewers

| Viewer | Holds the roles | Sees |
| --- | --- | --- |
| Guest | `Guest` | articles naming `Guest` |
| User | `Guest`, `User` | the above, plus articles naming `User` |
| Admin | `Guest`, `User`, `Admin` | everything |

The roles are the demo's own invention. The package never interprets a role
name — it hands the article's list to a `canSee` callback the host supplies and
does as it is told.

## Every article names its audience

Including this one. An article that names none is not "for everyone" — it is an
article whose author did not finish, and the package treats it that way: it is
reported as a warning and, by default, **no viewer can read it**.

There is one such article in this demo on purpose, and it is invisible until you
say otherwise. See *An article that forgot its roles*, which you cannot
currently open — that is the demonstration.

## The thing worth checking

Open your browser's network tab, switch to **Guest**, and read the response
from `/api/howto`. The administration articles are not in it — not their
bodies, not their summaries, not their titles.

That is the point. Filtering in the UI alone would leave every word of every
article sitting in a response a reader can open a devtools panel to read.
