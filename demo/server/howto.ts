/**
 * Everything the demo does with the package, in one file.
 *
 * This is the *server* half, and that split is the point of the demo rather
 * than an artefact of how it was built. Articles are read here, arranged here,
 * and — crucially — filtered here, so the browser is only ever sent what the
 * current viewer may read.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildManifest,
  buildSearchIndex,
  filterManifest,
  roleSetViewer,
  search,
  extractToc,
  validateArticles,
  type Article,
  type HowToConfig,
  type HowToViewer,
  type ManifestSection,
} from "@stonedogcode/howto";
import { loadArticles } from "@stonedogcode/howto/node";

import { VIEWERS, type ViewerId } from "../shared/viewers";

export const CONTENT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "content");

/**
 * The host declares the sections; articles slot themselves in by `section`.
 *
 * The ids match what `sectionFromDirectory` produces from the content tree:
 * a directory name lowercased, and nested directories joined with a hyphen —
 * `content/administration/billing` becomes `administration-billing`.
 */
export const config: HowToConfig = {
  sections: [
    { id: "getting-started", title: "Getting started" },
    { id: "using-the-surface", title: "Using the surface" },
    {
      id: "administration",
      title: "Administration",
      children: [{ id: "administration-billing", title: "Billing" }],
    },
  ],
};

/**
 * Read every article under `content/`, taking each one's section from the
 * directory it sits in unless it declared one itself.
 *
 * Re-read on each request rather than cached, so editing a markdown file and
 * refreshing shows the change. A production host would read once at build or at
 * boot; a demo whose articles do not update when you edit them teaches nothing
 * about the article format.
 */
export function readArticles(): Article[] {
  return loadArticles(CONTENT_DIR, { sectionFromDirectory: true });
}

/**
 * What the browser is sent. Note what is absent: there is no `roles` field and
 * no list of articles that were withheld.
 */
export interface HowToPayload {
  viewer: { id: ViewerId; label: string; roles: string[] };
  seesUnrestricted: boolean;
  sections: PayloadSection[];
  articles: PayloadArticle[];
  results: PayloadResult[] | null;
  /** Diagnostics for the demo's own explanatory panel. */
  stats: {
    total: number;
    visible: number;
    /** Articles declaring no `roles` — a count of unfinished frontmatter. */
    missingRoles: number;
  };
}

export interface PayloadSection {
  id: string;
  title: string;
  articleSlugs: string[];
  children: PayloadSection[];
}

export interface PayloadArticle {
  slug: string;
  title: string;
  summary: string | undefined;
  section: string;
  roles: string[] | undefined;
  body: string;
  toc: { id: string; text: string; depth: number }[];
}

export interface PayloadResult {
  slug: string;
  matchedHeadings: { id: string; text: string }[];
}

function toPayloadArticle(article: Article): PayloadArticle {
  return {
    slug: article.meta.slug,
    title: article.meta.title,
    summary: article.meta.summary,
    section: article.meta.section,
    // Echoed back only so the demo can *show* you what gated the article. A
    // real application has no reason to send this, and every reason not to:
    // it is a description of the access rules, handed to the public.
    roles: article.meta.roles,
    body: article.body,
    toc: extractToc(article.body),
  };
}

export interface BuildPayloadOptions {
  viewerId: ViewerId;
  /** Whether articles that declare no `roles` are readable. */
  seesUnrestricted: boolean;
  query: string;
}

/**
 * Build the response for one reader.
 *
 * Everything access-related happens in this function, on the server, before a
 * single byte reaches the browser.
 */
export function buildPayload({
  viewerId,
  seesUnrestricted,
  query,
}: BuildPayloadOptions): HowToPayload {
  const demoViewer = VIEWERS[viewerId];

  // The plain case the package ships a helper for: an article's `roles` list
  // checked against the roles the reader holds. A host with scopes or
  // per-organisation membership implements `HowToViewer` directly instead —
  // flattening that to a list of names is where privilege leaks between scopes.
  const viewer: HowToViewer = roleSetViewer({
    roles: demoViewer.roles,
    // The package defaults this to "deny". The switch is here so you can watch
    // what the other setting does — an article nobody classified becoming
    // readable by everyone — which is the failure the default prevents.
    unrestricted: seesUnrestricted ? "allow" : "deny",
  });

  const articles = readArticles();
  const manifest = buildManifest(articles, config);
  const visible = filterManifest(manifest, viewer);

  // Warnings, not errors: `buildManifest` above built this set successfully and
  // an article missing its `roles` is in it. Surfacing the count is the point —
  // an omission nobody counts is an omission nobody fixes.
  const missingRoles = validateArticles(articles, config).filter(
    (problem) => problem.kind === "missing-roles",
  );

  // Built over the *unfiltered* set and handed the viewer, because `search`
  // filters before it matches. Filtering afterwards would let result counts and
  // ranking disclose an article this reader may not open.
  const index = buildSearchIndex(articles);
  const trimmed = query.trim();
  const results =
    trimmed === ""
      ? null
      : search(index, trimmed, viewer).map((result) => ({
          slug: result.article.meta.slug,
          matchedHeadings: result.matchedHeadings.map((h) => ({ id: h.id, text: h.text })),
        }));

  return {
    viewer: { id: demoViewer.id, label: demoViewer.label, roles: demoViewer.roles },
    seesUnrestricted,
    sections: visible.sections.map(toPayloadSection),
    articles: [...visible.bySlug.values()].map(toPayloadArticle),
    results,
    stats: {
      total: articles.length,
      visible: visible.bySlug.size,
      missingRoles: missingRoles.length,
    },
  };
}

function toPayloadSection(section: ManifestSection): PayloadSection {
  return {
    id: section.id,
    title: section.title,
    articleSlugs: section.articles.map((a) => a.meta.slug),
    children: section.children.map(toPayloadSection),
  };
}
