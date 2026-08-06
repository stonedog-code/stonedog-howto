import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { filterManifest, roleSetViewer } from "../access";
import { ArticleParseError } from "../errors";
import { buildManifest } from "../manifest";
import { loadArticles } from "../node/loadArticles";
import { buildSearchIndex, search } from "../search";
import { extractToc } from "../toc";
import type { HowToConfig } from "../types";

/**
 * Integration tier: real markdown files, read off a real filesystem, all the way
 * through to a filtered manifest and a search result.
 *
 * The unit tests build articles from object literals, which cannot see anything
 * about the seam this exercises — recursion into subdirectories, the extension
 * filter, a stable order across filesystems, `sourcePath` being relative, or a
 * section defaulted from a directory. Those are exactly the parts a consumer
 * would otherwise reimplement, differently, in its own loader.
 */
const FIXTURES = join(process.cwd(), "test/fixtures/articles");

const config: HowToConfig = {
  sections: [
    { id: "general", title: "General" },
    {
      id: "admin",
      title: "Administration",
      children: [{ id: "billing", title: "Billing" }],
    },
    { id: "security", title: "Security" },
  ],
};

describe("loadArticles", () => {
  it("reads every markdown file, recursively, and ignores anything else", () => {
    const articles = loadArticles(FIXTURES, { sectionFromDirectory: true });

    expect(articles.map((a) => a.meta.slug).sort()).toEqual([
      "access-reviews",
      "getting-started",
      "invoices-2026",
      "members",
      "welcome",
    ]);
  });

  it("returns a stable order regardless of what readdir happens to give back", () => {
    // An unstable order makes article ordering depend on the machine that built
    // it, which is the kind of difference that only ever shows up in production.
    const once = loadArticles(FIXTURES, { sectionFromDirectory: true }).map((a) => a.sourcePath);
    const twice = loadArticles(FIXTURES, { sectionFromDirectory: true }).map((a) => a.sourcePath);

    expect(once).toEqual(twice);
    expect(once).toEqual([...once].sort());
  });

  it("records sourcePath relative to the root, not as an absolute path", () => {
    // So errors read the same on every machine and in CI, and a developer's disk
    // layout cannot end up quoted in a build log.
    const articles = loadArticles(FIXTURES, { sectionFromDirectory: true });
    for (const article of articles) {
      expect(article.sourcePath).toBeDefined();
      expect(article.sourcePath).not.toContain(process.cwd());
    }
    expect(articles.map((a) => a.sourcePath)).toContain("security/access-reviews.md");
  });

  it("lowercases a slug taken from a shouting filename", () => {
    const invoices = loadArticles(FIXTURES, { sectionFromDirectory: true }).find(
      (a) => a.sourcePath === "admin/billing/INVOICES-2026.md",
    );
    expect(invoices?.meta.slug).toBe("invoices-2026");
  });

  describe("sectionFromDirectory", () => {
    it("names the section after the directory, joining nested ones", () => {
      const articles = loadArticles(FIXTURES, { sectionFromDirectory: true });
      const bySlug = new Map(articles.map((a) => [a.meta.slug, a]));

      expect(bySlug.get("access-reviews")?.meta.section).toBe("security");
      expect(bySlug.get("members")?.meta.section).toBe("admin");
      expect(bySlug.get("welcome")?.meta.section).toBe("general");
    });

    it("leaves an article that declared its own section alone", () => {
      // `admin/billing/INVOICES-2026.md` declares `section: billing`. Deriving
      // would have made it `admin-billing`, silently re-sectioning an article
      // because of where its file sits.
      const invoices = loadArticles(FIXTURES, { sectionFromDirectory: true }).find(
        (a) => a.meta.slug === "invoices-2026",
      );
      expect(invoices?.meta.section).toBe("billing");
    });

    it("is off by default, so a missing section is an error rather than a guess", () => {
      expect(() => loadArticles(FIXTURES)).toThrow(ArticleParseError);
      expect(() => loadArticles(FIXTURES)).toThrow(/`section` is required/);
    });
  });

  it("names the file when one article in the set is malformed", () => {
    // The behaviour that matters at a hundred articles: which one is broken.
    const dir = mkdtempSync(join(tmpdir(), "howto-fixture-"));
    try {
      writeFileSync(join(dir, "fine.md"), "---\ntitle: Fine\nsection: general\n---\n\nProse.");
      writeFileSync(join(dir, "broken.md"), "---\nsection: general\n---\n\nNo title.");

      expect(() => loadArticles(dir)).toThrow(/broken\.md: frontmatter field `title` is required/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the whole path, from disk to a filtered surface", () => {
  const articles = loadArticles(FIXTURES, { sectionFromDirectory: true });
  const manifest = buildManifest(articles, config);

  it("builds a manifest with no problems from the files as written", () => {
    expect(manifest.bySlug.size).toBe(5);
    expect(manifest.sections.map((s) => s.id)).toEqual(["general", "admin", "security"]);
  });

  it("orders a section by the order its articles declare", () => {
    const general = manifest.sections.find((s) => s.id === "general");
    expect(general?.articles.map((a) => a.meta.slug)).toEqual(["welcome", "getting-started"]);
  });

  it("places a nested section's article by its declared section, not its path", () => {
    const billing = manifest.sections
      .find((s) => s.id === "admin")
      ?.children.find((c) => c.id === "billing");
    expect(billing?.articles.map((a) => a.meta.slug)).toEqual(["invoices-2026"]);
  });

  it("shows a reader with no roles only the unrestricted articles", () => {
    const filtered = filterManifest(manifest, roleSetViewer({ roles: [] }));

    expect([...filtered.bySlug.keys()].sort()).toEqual(["getting-started", "welcome"]);
    // Administration held only restricted articles, so the section is gone
    // entirely rather than rendered empty.
    expect(filtered.sections.map((s) => s.id)).toEqual(["general"]);
  });

  it("shows an Admin their own articles and still withholds the Owner one", () => {
    const filtered = filterManifest(manifest, roleSetViewer({ roles: ["Admin"] }));

    expect([...filtered.bySlug.keys()].sort()).toEqual([
      "getting-started",
      "invoices-2026",
      "members",
      "welcome",
    ]);
    expect(filtered.bySlug.has("access-reviews")).toBe(false);
  });

  it("builds tables of contents from the files, and suppresses the one-heading article", () => {
    const bySlug = new Map(articles.map((a) => [a.meta.slug, a]));

    expect(extractToc(bySlug.get("welcome")!.body).map((t) => t.id)).toEqual([
      "start-here",
      "where-to-go-next",
    ]);
    expect(extractToc(bySlug.get("getting-started")!.body)).toEqual([]);
  });

  it("searches the loaded set, and never returns an article the reader may not open", () => {
    const index = buildSearchIndex(articles);

    expect(search(index, "quarterly", roleSetViewer({ roles: ["Owner"] }))).toHaveLength(1);
    expect(search(index, "quarterly", roleSetViewer({ roles: ["Admin"] }))).toEqual([]);
  });
});
