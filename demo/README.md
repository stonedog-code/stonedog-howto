# The demo

A working how-to, built from the seven markdown files in `content/`, with three
audiences you can switch between.

```bash
npm install     # once, from the repository root
npm run dev     # → http://localhost:5174
```

No database, no credentials, no service to start alongside it. It runs against
this repository's own `src/`, not the published package, so editing the library
changes what the demo does on the next reload.

## What it demonstrates

**Articles that describe themselves.** Seven files, no central list. Add an
eighth by writing a file in `content/` and it appears.

**Sections that come from directories.** Articles are loaded with
`sectionFromDirectory: true`, so `content/administration/billing/invoices.md`
lands in section `administration-billing`, which the host has declared as a child
of `administration`. One file — `where-this-article-lives.md` — sits in
`using-the-surface/` and declares `section: getting-started`, because a declared
section beats the directory and that rule is worth being able to see.

**Three audiences.**

| Viewer | Holds | Sees |
| --- | --- | --- |
| Guest | `Guest` | 4 of 7 |
| User | `Guest`, `User` | 5 of 7 |
| Admin | `Guest`, `User`, `Admin` | 7 of 7 |

Roles accumulate rather than replace. That is this demo's choice, not the
package's: an article's `roles` is a set-membership test, so a host that wants a
hierarchy builds one by granting the lower roles alongside the higher one.

**Sections disappearing rather than emptying.** As a Guest, *Administration* is
not an empty heading — it is absent. An empty section's title still tells a
reader that a subject exists which they are not entitled to know about.

**The `seesUnrestricted` switch.** Turn it off and articles that declare no
`roles` become unreadable. A Guest then sees exactly one article: the one that
names `Guest` explicitly.

## The part worth opening devtools for

Switch to **Guest** and read the `/api/howto` response in the network tab.

The administration articles are not in it. Not their bodies, not their
summaries, not their titles, not their slugs. Search behaves the same way — as a
Guest, searching `invoice` returns nothing, because `search` filters before it
matches rather than after.

That is the claim the package makes, and this demo is arranged so that you can
falsify it if it were untrue.

## How it is put together

| | |
| --- | --- |
| `content/` | the articles, in directories |
| `shared/viewers.ts` | the three audiences — imported by both halves |
| `server/howto.ts` | loads, arranges and **filters**; runs in Node only |
| `vite.config.ts` | the `/api/howto` middleware, and the aliases onto `../src` |
| `src/` | the browser half: fetch, render, impersonation switcher |

`shared/viewers.ts` exists as its own module for a reason worth copying: the
switcher in the header needs the viewer labels, and importing them from
`server/howto.ts` would drag `node:fs` into the browser bundle through the
article loader. The package puts its filesystem helpers behind a separate entry
point (`stonedog-howto/node`) precisely so that cannot happen by accident,
and a demo that defeated that would be a poor advertisement for it.

The demo is styled with plain CSS in `src/styles.css`, hanging off the
`data-testid` attributes the components already emit. Nothing here required a
change to the package. A demo built on `stonedog-howto/styled` would show
what the design system looks like; this shows what you get with none.

## Two things it does that a real application must not

**The viewer arrives as a query parameter.** `?viewer=admin` is impersonation
for a demo. In a real application the reader's identity comes from the session,
and a client that can name its own audience is not an access control at all.

**The article's `roles` are echoed back to the browser**, so the page can show
you what gated each one. A real application has no reason to send that and every
reason not to — it is a description of the access rules, published.

## There is no `build`

Deliberately. The filtering lives in the dev-server middleware, so a static
build would produce a site whose own `/api/howto` returns 404 — a broken
artefact that looks like a working one.

The change that would make a build possible is moving the filtering into the
browser, and that is the one change this demo must never accept: it would ship
every article to every reader and hide some in the UI, which is exactly what the
package exists to stop. `npm run type-check` covers compilation.

## Not published

`demo/` is a private workspace and is excluded from the tarball: `files` in the
root `package.json` ships `src/` alone. It travels with the repository, not with
the package.
