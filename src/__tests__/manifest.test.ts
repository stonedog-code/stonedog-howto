import { ManifestError } from "../errors";
import { buildManifest, validateArticles } from "../manifest";
import type { Article, HowToConfig } from "../types";

const article = (
  slug: string,
  section: string,
  extra: Partial<Article["meta"]> = {},
): Article => ({
  meta: { title: slug, slug, section, order: 0, ...extra },
  body: "Body.",
  sourcePath: `articles/${slug}.md`,
});

const config: HowToConfig = {
  sections: [
    { id: "getting-started", title: "Getting started" },
    {
      id: "admin",
      title: "Administration",
      children: [{ id: "security", title: "Security" }],
    },
  ],
};

describe("buildManifest", () => {
  it("places each article in its declared section", () => {
    const manifest = buildManifest(
      [article("welcome", "getting-started"), article("access-reviews", "security")],
      config,
    );

    expect(manifest.sections[0]?.articles.map((a) => a.meta.slug)).toEqual(["welcome"]);
    expect(manifest.sections[1]?.children[0]?.articles.map((a) => a.meta.slug)).toEqual([
      "access-reviews",
    ]);
  });

  it("sorts by order, then title", () => {
    const manifest = buildManifest(
      [
        article("third", "getting-started", { order: 10, title: "Third" }),
        article("bravo", "getting-started", { order: 0, title: "Bravo" }),
        article("alpha", "getting-started", { order: 0, title: "Alpha" }),
      ],
      config,
    );

    expect(manifest.sections[0]?.articles.map((a) => a.meta.title)).toEqual([
      "Alpha",
      "Bravo",
      "Third",
    ]);
  });

  it("keeps a section with no articles, so the arrangement is the host's to decide", () => {
    const manifest = buildManifest([article("welcome", "getting-started")], config);
    expect(manifest.sections[1]?.articles).toEqual([]);
    expect(manifest.sections[1]?.children[0]?.articles).toEqual([]);
  });

  it("indexes every article by slug", () => {
    const manifest = buildManifest(
      [article("welcome", "getting-started"), article("access-reviews", "security")],
      config,
    );
    expect(manifest.bySlug.get("access-reviews")?.meta.section).toBe("security");
    expect(manifest.bySlug.size).toBe(2);
  });

  it("refuses to build when an article names a section that does not exist", () => {
    // The alternative is dropping it silently, which is indistinguishable from
    // the article never having been written.
    expect(() => buildManifest([article("orphan", "no-such-section")], config)).toThrow(
      ManifestError,
    );
    expect(() => buildManifest([article("orphan", "no-such-section")], config)).toThrow(
      /would render nowhere/,
    );
  });

  it("refuses to build on a duplicate slug, naming both files", () => {
    const problems = validateArticles(
      [
        { ...article("notes", "getting-started"), sourcePath: "articles/a/notes.md" },
        { ...article("notes", "security"), sourcePath: "articles/b/notes.md" },
      ],
      config,
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]?.kind).toBe("duplicate-slug");
    expect(problems[0]?.sourcePaths).toEqual(["articles/a/notes.md", "articles/b/notes.md"]);
  });

  it("catches a duplicate section id anywhere in the tree", () => {
    const clashing: HowToConfig = {
      sections: [
        { id: "admin", title: "Administration", children: [{ id: "admin", title: "Again" }] },
      ],
    };
    expect(validateArticles([], clashing).map((p) => p.kind)).toEqual([
      "duplicate-section-id",
    ]);
  });

  it("reports every problem at once rather than one per run", () => {
    const problems = validateArticles(
      [article("a", "nope"), article("b", "also-nope")],
      config,
    );
    expect(problems).toHaveLength(2);
  });
});
