---
title: An article that forgot its roles
order: 40
summary: Declares no audience, on purpose, so you can see what happens to one.
---

This article's frontmatter names no `roles`. That is deliberate, and it is the
only article here like it.

## Why you are probably not reading this

By default, **no viewer can open it**. `roleSetViewer` and `mappedRoleViewer`
both default `unrestricted` to `"deny"`, so an article that entitles nobody is
readable by nobody. To see this page, tick *Show articles that name no roles* in
the header — the switch that flips that policy to `"allow"`.

## Why the default is deny

The tempting default is the opposite: no roles means no restriction, so anyone
may read it. It reads as permissive and harmless, and it is neither.

An article naming no audience has not said "everyone". It has said *nothing* —
and by far the most common reason is that whoever wrote it forgot the field.
Under the permissive default, the one article nobody finished becomes the one
article everybody can read. The failure is silent in the direction that matters:
nobody reports being shown too much.

Deny inverts that. A forgotten `roles` makes an article disappear, somebody asks
where it went, and the frontmatter gets fixed.

## How you find these

`validateArticles` reports each one as a `missing-roles` problem naming the file,
with `severity: "warning"`:

```ts
const problems = validateArticles(articles, config);
const unfinished = problems.filter((p) => p.kind === "missing-roles");
```

A warning rather than an error, because `buildManifest` still builds. Refusing
to build over an incomplete article would take a hundred good ones offline for
one bad one, which is how a useful check ends up deleted by whoever needed a
green build.

The count is in this demo's stats panel, which is the whole discipline in one
line: **an omission nobody counts is an omission nobody fixes.**

## What a host does about it

Show them. A reader entitled to fix an article should be able to see that it
needs fixing — so a host typically decides the policy per reader:

```ts
roleSetViewer({
  roles: reader.roles,
  unrestricted: reader.isOperator ? "allow" : "deny",
})
```

That is how "only operators see unfinished articles" is expressed without the
package ever learning what an operator is.
