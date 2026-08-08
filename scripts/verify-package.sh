#!/usr/bin/env bash
#
# Prove the PACKAGE works, not just the checkout.
#
# Everything the test suite does runs against source files sitting in this
# repository, where `files`, the `exports` map and the tarball contents are
# invisible. Those are exactly what breaks at publish time — after review, when
# the version is already burned and cannot be reused.
#
# So: pack it, install the tarball into a throwaway project, and use it the way a
# consumer would — typecheck against the published `exports`, then execute.
#
# Found on its first run: `files: ["src"]` was shipping the entire test suite,
# which consumers' Panda `include` globs would have statically parsed.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

cd "$ROOT"
TARBALL="$WORK/$(basename "$(npm pack --pack-destination "$WORK" | tail -1)")"
echo "packed: $(basename "$TARBALL")"

# No test file may reach a consumer: they are parsed by the consumer's Panda
# build and import test globals that are not dependencies.
if tar -tzf "$TARBALL" | grep -q "__tests__"; then
  echo "FAIL: the tarball contains test files" >&2
  tar -tzf "$TARBALL" | grep "__tests__" >&2
  exit 1
fi

mkdir -p "$WORK/consumer/src"
cd "$WORK/consumer"

cat > package.json <<'JSON'
{ "name": "consumer-check", "private": true, "type": "module", "version": "1.0.0" }
JSON

cat > tsconfig.json <<'JSON'
{
  "compilerOptions": {
    "target": "ESNext", "module": "ESNext", "moduleResolution": "bundler",
    "jsx": "react-jsx", "strict": true, "noEmit": true, "skipLibCheck": true,
    "lib": ["dom", "esnext"], "types": ["node"]
  },
  "include": ["src/**/*.ts"]
}
JSON

# Deliberately imports through the package NAME, never a relative path, so this
# resolves via the published `exports` map rather than the local file layout.
cat > src/check.ts <<'TS'
import {
  parseArticle, buildManifest, filterManifest, mappedRoleViewer, roleSetViewer,
  extractToc, buildSearchIndex, search, validateArticles,
  type Article, type HowToConfig, type HowToViewer,
} from "@stonedogcode/howto";
import { loadArticles } from "@stonedogcode/howto/node";

const config: HowToConfig = { sections: [{ id: "general", title: "General" }] };
const article: Article = parseArticle(
  "---\ntitle: Welcome\nsection: general\nroles: [Admin]\n---\n\n## One\n\nx\n\n## Two\n\ny",
  { sourcePath: "welcome.md" },
);
const viewer: HowToViewer = roleSetViewer({ roles: ["Admin"] });
const manifest = filterManifest(buildManifest([article], config), viewer);
const results = search(buildSearchIndex([article]), "welcome", viewer);

if (article.meta.slug !== "welcome") throw new Error("slug not derived");
if (manifest.sections.length !== 1) throw new Error("manifest not built");
if (results.length !== 1) throw new Error("search found nothing");
if (extractToc(article.body).length !== 2) throw new Error("toc not extracted");
if (typeof loadArticles !== "function") throw new Error("node entry point missing");

// An article naming no audience entitles nobody, and is reported rather than
// guessed at. Checked from an installed tarball because it is the package's
// most consequential default: the version that got this wrong would publish
// every article whose author forgot the field.
const unfinished: Article = parseArticle(
  "---\ntitle: Unfinished\nsection: general\n---\n\nx",
  { sourcePath: "unfinished.md" },
);
const openManifest = buildManifest([article, unfinished], config);
if (openManifest.bySlug.size !== 2) throw new Error("a warning must not stop the build");
if (filterManifest(openManifest, viewer).bySlug.has("unfinished")) {
  throw new Error("an article naming no roles must reach nobody by default");
}
const warned = validateArticles([article, unfinished], config);
if (!warned.some((p) => p.kind === "missing-roles" && p.severity === "warning")) {
  throw new Error("missing roles must be reported as a warning");
}

// The mapping viewer, exercised through the published exports — an export that
// type-checks in this repo but never made it into `files` is the failure this
// script exists to catch.
const mapped = mappedRoleViewer({
  viewerRoles: ["Editor"],
  mapping: { Editor: ["Admin"] },
});
if (!mapped.canSee(["Admin"])) throw new Error("mapping did not grant");
if (mapped.canSee(["Unmapped"])) throw new Error("an unmapped role must deny");
if (mapped.canSee(undefined)) throw new Error("no roles must deny by default");

console.log("package verified: exports resolve, types check, code runs");
TS

npm install --silent --no-audit --no-fund \
  "$TARBALL" typescript@^5.9.3 @types/node@^22 react@^19 @types/react@^19 tsx@^4 >/dev/null

echo "typechecking as a consumer…"
npx tsc --noEmit

echo "running as a consumer…"
npx tsx src/check.ts
