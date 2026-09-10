# howto — the internal documentation portal

One access-controlled, searchable view of the how-to articles that live inside
HopperGuard, RozCards and Optima Filings Cloud — readable in a browser, and
askable over MCP.

**Apache-2.0**, like the rest of this repository — see [LICENSE](../LICENSE).

The *code* is open source; the *content it serves* is not. This portal reads
article trees named in an `articles.json` you supply, and a deployment of it is
an access-controlled internal surface. Publishing the mechanism is deliberate;
publishing anyone's articles is not, which is why no `articles.json` ships here
— only [`articles.example.json`](./articles.example.json).

## Status

**Running.** The container serves two source repositories on `localhost:3000`.

**The access model was revised on 2026-08-08** — see
[`docs/prd/portal.md`](./docs/prd/portal.md). The repository, not a group, is
the scope, and source roles are mapped explicitly rather than ignored.

| | |
| --- | --- |
| Signup, including the first-admin rule and its race | ✅ |
| Password hashing via `@stonedogcode/auth` | ✅ |
| Capability model, roles, the Guest rung | ✅ |
| Repository scoping — grants, subject, readable set | ✅ |
| Prisma schema, with the first-admin index proven against real Postgres | ✅ |
| The how-to viewer, resolving a role mapping | ✅ |
| The real stores | ✅ |
| Next.js UI | ✅ |
| Hourly filesystem sync driven by `articles.json` | ✅ |
| MCP search server (`stonedog-howto-mcp`) | ✅ built; not yet exercised against the live archive |
| Every dependency resolvable from npm | ✅ |
| Container actually building, and running | ✅ |
| **A screen to grant a user a repository** | ⬜ — nothing writes `RepoGrant`, so the portal is effectively single-user |

As of 2026-08-14 it serves **114 articles** from two of its three intended
sources, with none missing an audience:

```
Hopperguard          | Active | 109 articles | 0 missing roles
Optima Filings Cloud | Active |   5 articles | 0 missing roles
```

rozcards is the third and is deliberately not registered yet: its 23 articles
are markdown but none declares `roles`, so syncing it today would put all 23
behind the missing-roles badge. `articles.json` carries a note saying so.

**The database is the local compose Postgres** and nothing else — see
`docker-compose.yml` for why that is a deliberate departure from the house rule
rather than an oversight. `npm run verify:schema` proves the migration against a
throwaway container and needs no provisioned database at all, including the race
it exists for, by running eight concurrent signups and asserting exactly one
admin survives.

## Bringing it up from nothing

```bash
npm run db:up                       # the compose Postgres, on :55432
npm run db:migrate
docker build -t howto-portal:latest \
  --build-arg APP_VERSION=$(node -p "require('./package.json').version") \
  --build-arg GIT_SHA=$(git rev-parse --short HEAD) .
docker run -d --name howto-portal -p 3000:3000 \
  --add-host host.docker.internal:host-gateway \
  -e DATABASE_URL='postgresql://howto:howto-local-only@host.docker.internal:55432/howto?schema=public' \
  -e DATABASE_DIRECT_URL='postgresql://howto:howto-local-only@host.docker.internal:55432/howto?schema=public' \
  -e SESSION_SECRET='local-development-session-secret-not-a-real-key' \
  howto-portal:latest
```

Then, and the **order matters**:

1. **Create an account row.** Signup attaches a user to an account that already
   exists — `accountHasAdmin` deliberately does not ask whether the account row
   is there — and no screen creates one yet.
2. **Sign up at `/signup`.** The first person to join an account becomes its
   admin, arbitrated by a partial unique index rather than a count-then-insert.
3. **Promote to `SystemAdmin` if you need to see everything.** It is deliberately
   *not* a rung of the account ladder: it is a globally-held capability, assigned
   out of band, so there is no screen for it on purpose.

   Doing this leaves the account with no `AccountAdmin`, which is fine — a
   `SystemAdmin` administers it — and **is no longer an opening**. It was: the
   first-admin rule asked only whether an `AccountAdmin` existed, so after this
   step the account honestly had none and the next person to sign up was offered
   the role. Signup needs an account id and a password of the signer's choosing
   and nothing else. `accountHasAdmin` now counts either administrator, so this
   step hands nothing away.

   If you want the account to keep an admin of its own, promote a **second**
   user instead of the first, or assign `AccountAdmin` to somebody afterwards.
   There is no screen for either yet — both are an `UPDATE`.
4. **Adopt each repository at `/admin/mapping`.** A repository the config names
   but nobody has mapped syncs **nothing** — content nobody has decided about
   should not be in the portal at all. Grant a portal role *All roles* to adopt
   it; the per-source-role columns appear after the first sync.
5. **`npm run sync`.** Exits non-zero if anything was skipped *or* if a
   configured repository ended the run serving nothing.

The hourly cron (`scripts/sync-cron.sh`) does steps 5 onward by itself, and
refreshes each source worktree that opts in first.

## The Dockerfile builds, and the gate runs inside it

`npm run type-check && npm test` runs in the **builder** stage, not only in CI.
The two can disagree — a different Node minor, a different platform binary for
argon2 — and the image is the artefact that serves traffic.

**Build it from a clean clone at least once before believing it works.** Until
2026-08-14 there was no `.dockerignore`, so `COPY . .` copied the host's
`node_modules` straight over the `npm ci` the line above it had just run: the
in-image gate tested whatever was on a developer's disk rather than the
lockfile, which is the exact thing that comment says `npm ci` prevents. It also
hid a second bug completely — the host's `node_modules` carries the *generated*
Prisma client, so `type-check` passed everywhere somebody had installed and a
clean clone failed with a dozen errors about Prisma types being `any`. The
builder now runs `prisma generate` before the gate. The part still open is building the
image **in CI**, which is the only check that would catch the next one of these.

`APP_VERSION` and `GIT_SHA` must reach the builder stage rather than only the
runtime one: anything a prerendered page reads is evaluated during the build and
frozen into static HTML, so a value injected into the running container arrives
after the page displaying it has been written. `/api/health` reports both, which
is how you tell which commit is actually serving:

```
$ curl -s localhost:3000/api/health
{"status":"ok","version":"0.1.0","sha":"d73329b","database":"ok"}
```

No secret is ever a build arg — those are recoverable from `docker history`.
The two above are a version string and a sha.

## The three packages, and what each decides

| Package | Owns |
| --- | --- |
| `@stonedogcode/howto` | the article format, the manifest, filtering, rendering |
| `@stonedogcode/auth` | password hashing and policy, single-use emailed tokens |
| `@stonedogcode/rbac` | `can(subject, capability, scope)` |

`src/lib/rbac.ts` is the only file that knows how they fit together.

## Access model, in short

**A synced repository is the RBAC scope.** A user is granted a repository, and
an explicit, portal-managed mapping decides which of that repository's own role
names they may see within it. One person can hold different rights in each.

**Absence denies.** A source role nobody mapped is a source role nobody can
read. This is what makes a mapping mistake *hide* articles rather than disclose
them — the first is a complaint, the second is silent.

This reverses the original decision, which made a flat group the scope and had
source roles grant nothing at all. The danger it was aimed at was real but
mis-aimed: mapping source roles is safe, mapping them **implicitly** is not.
`docs/prd/portal.md` records the reversal and why.

**`roles` is required on every article.** One that declares none is not
unrestricted, it is broken: visible to system administrators alone, rendered
with a badge saying so, and counted by every sync run.

HopperGuard already behaves this way — 101 of its 105 articles declare no roles,
and its own viewer makes an untagged article System-Admin-only. But that rule
lives in *its* viewer, not in the files, and the package's stock viewer decides
the opposite. A second reader of the same directory publishes all 101.

**System admin is not a rung.** It holds its capabilities *globally*; a rung
would inherit the account admin's capabilities in whatever scope the assignment
named, which is how a global role leaks into a per-account check. Guest, by
contrast, *is* a rung — the lowest.

## The first user of an account is its admin

Settled by the database, not by a count. `if (userCount === 0)` is a
check-then-act, and two simultaneous signups both read zero — a double-clicked
button on a slow connection is enough. The store claims the admin slot
atomically and the loser is told it lost; `signup` reports the role the store
**assigned**, never the one it asked for. Eight concurrent signups yielding
exactly one admin is a test.

## Syncing articles

`articles.json` names each source repository and where its articles live. The
**name** is the identity — permissions and role mappings are keyed on it, so a
repository that moves on disk keeps its configuration, and one removed and
re-added gets it back.

```bash
npm run db:up && npm run db:migrate
npm run sync
```

```
Hopperguard: synced — 105 taken, 0 skipped, 101 missing roles
```

**Read that second and third number.** A skipped article is one the portal does
not have and nobody asked it to drop, so `npm run sync` exits non-zero when
anything was skipped — a cron job that exits 0 regardless reports success
forever while the archive quietly goes incomplete.

`missing roles` counts articles that name no audience. They reach system
administrators alone; the number exists so the backfill can be finished rather
than forgotten.

**A repository nobody has mapped syncs nothing at all.** Not sync-then-hide:
content nobody has mapped is content nobody has decided about, and the safe
state for an undecided article is not to be in the portal.

### Hourly

A crontab line, because the portal runs on one machine and a scheduler inside
the app would be a daemon to supervise for no gain:

```cron
17 * * * * ARTICLES_CONFIG=/path/to/articles.json /path/to/portal/scripts/sync-cron.sh >> ~/.local/state/howto/sync.log 2>&1
```

`sync-cron.sh` reads `DATABASE_URL` from `portal/.env` itself — copy
`.env.example`. Prisma will not find that file on its own: npm workspaces hoist
the generated client to the repository root, and a client generated there loads
no `.env` at all, so a cron run that relied on it failed every hour with
*"Environment variable not found: DATABASE_URL"*. A variable already exported
wins over the file, and a run with neither stops with a `FATAL` naming it.

### The paths are read at sync time, from the working tree

Not from a commit. If a source checkout is behind its own `main`, the portal
reads what is on disk and reports it honestly — which is a feature, and the
first real run demonstrated it: 101 articles reported as missing roles because
that checkout predated the backfill that gave them one.

## Development

```bash
npm install
npm run gate     # type-check, lint, test
```

No sibling checkouts required — every dependency comes from npm.
