#!/usr/bin/env bash
# Copyright (C) 2026 StoneDogCode L.L.C.
# SPDX-License-Identifier: Apache-2.0
#
# Publish @stonedogcode/howto to npm, end to end.
#
#   npm run publish:stonedog-howto
#
# Run it from a terminal, interactively. npm prompts for the 2FA one-time
# password itself (account `stonedogcode`) and the browser login flow needs a
# human — neither works unattended, which is why this is a script you run
# rather than a step in CI.
#
# Modelled on @stonedogcode/style's script of the same name, and it keeps that one's
# central lesson: a publish that prints no error can still have published
# nothing, or the wrong thing. So this reads the tarball before publishing and
# installs from the registry afterwards, because "the registry lists it" and
# "a user can install it" are different claims and the second is the last to
# start answering yes.
#
# ## The traps specific to THIS package
#
# 0. **The name is SCOPED, and that is settled.** It was briefly renamed to the
#    unscoped `stonedog-howto` on 2026-08-07 to match the then-unscoped style/theme/rbac,
#    then reverted the same day when the decision went the other way: all five
#    shared packages scope under @stonedogcode (NEH-482). The rename never
#    reached the registry, so `stonedog-howto` does not exist and nothing
#    depended on it. Do not redo it.
#
#    The alias is written in FOUR places — demo/vite.config.ts, demo/tsconfig,
#    the root tsconfig, jest.config.cjs — and each tool reads only its own. The
#    vite entries are anchored REGEXES, so a find-and-replace over the plain
#    specifier misses them and the demo silently exercises the last published
#    release instead of the working tree, with everything still building.
#
# 1. It ships TypeScript SOURCE under `src/`, and consumers add
#    `node_modules/@stonedogcode/howto/src/**` to their Panda `include` globs. So
#    anything shipped under src/ is statically parsed at the CONSUMER's build.
#    `files: ["src"]` therefore shipped the entire test suite until it was
#    caught — jest globals and fixture markup, parsed by every consumer. The
#    tarball is refused below if a test file is in it.
#
# 2. It has THREE entry points (`.`, `./node`, `./styled`). A tarball missing
#    any one of them installs fine and fails at the consumer's first import.
#
# 3. `react`/`react-dom` are peers ONLY. Listed as dependencies too — as they
#    briefly were — npm installs a second React into the package, and two
#    Reacts in one tree fail with "Invalid hook call", pointing at the
#    consumer's component rather than at this manifest.
set -euo pipefail

PACKAGE_NAME="@stonedogcode/howto"
# Sanity floor for the tarball. Comfortably under the real count (22) so
# ordinary growth does not trip it, far above what a `files`-misconfigured
# package would produce (3: package.json, README, LICENSE).
MIN_FILES=15
# Every path `exports` names.
REQUIRED_PATHS=("src/index.ts" "src/node/index.ts" "src/styled/index.ts")

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

say()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[31mREFUSING: %s\033[0m\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# 1. Publish from a clean, current `main`.
# ---------------------------------------------------------------------------
say "Checking the working tree"
BRANCH="$(git branch --show-current)"
[ -n "$BRANCH" ] || fail "this checkout is in detached HEAD. Run: git checkout main && git pull"
[ "$BRANCH" = "main" ] || fail "on branch '$BRANCH'. Publish from main, never a feature branch."
[ -z "$(git status --porcelain | grep -v '^??')" ] || fail "the working tree has uncommitted changes."

git fetch --quiet origin
if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
  BEHIND="$(git rev-list --count HEAD..origin/main)"
  fail "HEAD is not origin/main ($BEHIND commit(s) behind). A checkout one commit behind publishes a tarball missing the very thing you are publishing for, and it looks like a success. Run: git pull"
fi
echo "  clean, on main, at $(git rev-parse --short HEAD)"

# `styled-system/` is generated and gitignored, so `git checkout` leaves a stale
# one behind when moving between branches whose Panda config differs. Lint then
# fails on generated files nobody wrote. Regenerating is part of the gate below,
# but the stale tree is removed first so the gate cannot pass on old output.
rm -rf styled-system

# ---------------------------------------------------------------------------
# 2. Authenticate.
#
# A 404 from `npm publish` means AUTH far more often than a missing package —
# npm answers 404 rather than 403 so it cannot leak whether a name exists. `npm
# whoami` turns that confusing failure into a clear one, and is the only thing
# that reveals an `_authToken` that is present but expired.
# ---------------------------------------------------------------------------
say "Checking npm authentication"
if ! NPM_USER="$(npm whoami 2>/dev/null)"; then
  echo "  not logged in — starting the browser login flow"
  npm login
  NPM_USER="$(npm whoami)"
fi
echo "  authenticated as $NPM_USER"

if npm view "$PACKAGE_NAME" version >/dev/null 2>&1; then
  npm owner ls "$PACKAGE_NAME" 2>/dev/null | grep -q "^$NPM_USER " \
    || fail "'$NPM_USER' is not an owner of $PACKAGE_NAME, so publishing will fail with a misleading 404."
  echo "  $NPM_USER is an owner of $PACKAGE_NAME"
else
  echo "  $PACKAGE_NAME does not exist yet — this is the first publish, which creates it"
fi

# ---------------------------------------------------------------------------
# 3. A version may be published at most once, ever.
# ---------------------------------------------------------------------------
VERSION="$(node -p "require('./package.json').version")"
say "Preparing $PACKAGE_NAME@$VERSION"

if npm view "$PACKAGE_NAME@$VERSION" version >/dev/null 2>&1; then
  fail "$PACKAGE_NAME@$VERSION is already published. A version can never be reused — bump it (npm run version:bump:patch), land that, then re-run."
fi

# ---------------------------------------------------------------------------
# 4. The gate, then the package check.
#
# Both, and in this order. The gate proves the SOURCE is good; verify:package
# proves what a CONSUMER receives is good. Publishing is irreversible on a
# version number, so neither is assumed from a green PR — this checkout may
# carry commits that merged after the last CI run.
# ---------------------------------------------------------------------------
say "Running the gate"
npm run gate

say "Verifying the package as a consumer receives it"
npm run verify:package

# ---------------------------------------------------------------------------
# 5. Read the tarball before trusting it.
# ---------------------------------------------------------------------------
say "Verifying the tarball"
PACK_OUTPUT="$(npm pack --dry-run 2>&1)"
FILE_COUNT="$(printf '%s' "$PACK_OUTPUT" | sed -n 's/.*total files:[[:space:]]*\([0-9]*\).*/\1/p' | tail -1)"

[ -n "$FILE_COUNT" ] || fail "could not read a file count from npm pack."
[ "$FILE_COUNT" -ge "$MIN_FILES" ] \
  || fail "the tarball has only $FILE_COUNT files (expected >= $MIN_FILES). Publishing this would ship a near-empty package on a version number that can never be reused."

printf '%s' "$PACK_OUTPUT" | grep -q '__tests__' \
  && fail "the tarball contains test files. Consumers parse node_modules/$PACKAGE_NAME/src/** with Panda, so these would be statically parsed at their build, and they import jest globals that are not dependencies."

for path in "${REQUIRED_PATHS[@]}"; do
  printf '%s' "$PACK_OUTPUT" | grep -q "$path" \
    || fail "'$path' is not in the tarball, but package.json's \"exports\" names it. Every consumer import of that entry point would fail."
done

printf '%s' "$PACK_OUTPUT" | grep -q 'README.md' \
  || fail "no README.md in the tarball — npmjs.com would show 'This package does not have a README'."
printf '%s' "$PACK_OUTPUT" | grep -q 'LICENSE' \
  || fail "no LICENSE in the tarball. This package is Apache-2.0 and the licence text ships with it."

node -e '
  const d = require("./package.json");
  const deps = Object.keys(d.dependencies || {});
  for (const p of ["react", "react-dom"]) {
    if (deps.includes(p)) {
      console.error(`REFUSING: ${p} is a dependency as well as a peer. npm installs a second React into this package, and two Reacts in one tree fail with "Invalid hook call".`);
      process.exit(1);
    }
  }
'

echo "  $FILE_COUNT files; entry points, README and LICENSE present; no tests; react is peer-only"

say "Tarball contents — read this before confirming"
printf '%s\n' "$PACK_OUTPUT" | sed -n 's/^npm notice[[:space:]]*[0-9.]*[kMG]*B*[[:space:]]*\(src\/.*\)/  \1/p' | sort
echo "  ($FILE_COUNT files total)"

# ---------------------------------------------------------------------------
# 6. Publish. npm prompts for the OTP here.
# ---------------------------------------------------------------------------
say "Publishing $PACKAGE_NAME@$VERSION — npm will ask for your 2FA code"
npm publish --access public

# ---------------------------------------------------------------------------
# 7. PROVE IT. The registry is eventually consistent for a few seconds, so this
#    polls rather than asserting once, and ends with a real install.
# ---------------------------------------------------------------------------
say "Verifying it is actually installable"
PROBE_DIR="$(mktemp -d)"
trap 'rm -rf "$PROBE_DIR"' EXIT

for attempt in $(seq 1 20); do
  if npm view "$PACKAGE_NAME@$VERSION" version >/dev/null 2>&1; then break; fi
  [ "$attempt" -lt 20 ] || fail "$PACKAGE_NAME@$VERSION is still not on the registry after publishing. The publish did NOT succeed, whatever it printed."
  sleep 3
done

printf '{"name":"probe","version":"1.0.0"}' > "$PROBE_DIR/package.json"
(cd "$PROBE_DIR" && npm install --silent "$PACKAGE_NAME@$VERSION" >/dev/null 2>&1) \
  || fail "$PACKAGE_NAME@$VERSION resolves but cannot be installed."

INSTALLED="$(node -p "require('$PROBE_DIR/node_modules/$PACKAGE_NAME/package.json').version")"
[ "$INSTALLED" = "$VERSION" ] || fail "installed $INSTALLED but published $VERSION."

for path in "${REQUIRED_PATHS[@]}"; do
  [ -f "$PROBE_DIR/node_modules/$PACKAGE_NAME/$path" ] \
    || fail "$path is missing from the INSTALLED package, though it was in the tarball."
done

printf '\n\033[32m✓ %s@%s is published and installable.\033[0m\n' "$PACKAGE_NAME" "$VERSION"
echo "  https://www.npmjs.com/package/$PACKAGE_NAME"
printf '\n\033[1mNext:\033[0m each consumer picks this up by adding the dependency. A consumer using\n'
printf '  the ./styled entry point must also add BOTH node_modules paths for this package\n'
printf '  to its Panda `include` globs — a glob that matches nothing fails silently.\n'
