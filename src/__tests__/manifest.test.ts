import { ManifestError } from "../errors";
import { buildManifest, validateArticles } from "../manifest";
import type { Article, HowToConfig } from "../types";

/**
 * A well-formed article. Declares `roles`, because every article should — a
 * fixture omitting it now raises a `missing-roles` warning, which would then
 * turn up in tests that are about something else entirely.
 */
const article = (
  slug: string,
  section: string,
  extra: Partial<Article["meta"]> = {},
): Article => ({
  meta: { title: slug, slug, section, order: 0, roles: ["Reader"], ...extra },
  body: "Body.",
  sourcePath: `articles/${slug}.md`,
});

/** An article naming no audience — what `missing-roles` is about. */
const articleWithoutRoles = (slug: string, section: string): Article => ({
  meta: { title: slug, slug, section, order: 0 },
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

describe("missing roles", () => {
  const withRoles = (slug: string) => article(slug, "getting-started");

  it("reports an article that declares no roles, naming its file", () => {
    const problems = validateArticles(
      [articleWithoutRoles("orphan", "getting-started")],
      config,
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({
      kind: "missing-roles",
      severity: "warning",
      subject: "orphan",
      sourcePaths: ["articles/orphan.md"],
    });
  });

  it("says nothing about an article that declares roles", () => {
    expect(validateArticles([withRoles("welcome")], config)).toEqual([]);
  });

  // An empty `roles` list is rejected at parse time, so it never reaches here.
  // What does reach here is a list with entries, and that is not a problem.
  it("does not confuse a declared role list with an absent one", () => {
    const problems = validateArticles(
      [article("scoped", "getting-started", { roles: ["Owner", "Auditor"] })],
      config,
    );
    expect(problems).toEqual([]);
  });

  // The whole reason severity exists. Refusing to build over an unfinished
  // article would take every good article offline with it, which is how a
  // useful check gets deleted by whoever needed a green build.
  it("still builds the manifest, placing the article normally", () => {
    const manifest = buildManifest(
      [articleWithoutRoles("orphan", "getting-started"), withRoles("welcome")],
      config,
    );

    expect(manifest.bySlug.has("orphan")).toBe(true);
    expect(manifest.sections[0]?.articles.map((a) => a.meta.slug)).toEqual([
      "orphan",
      "welcome",
    ]);
  });

  // ...but a real error still stops it, alongside the warning.
  it("throws on an error even when a warning is present, reporting only the error", () => {
    let caught: ManifestError | undefined;
    try {
      buildManifest([articleWithoutRoles("orphan", "does-not-exist")], config);
    } catch (error) {
      caught = error as ManifestError;
    }

    expect(caught).toBeInstanceOf(ManifestError);
    expect(caught?.problems.map((p) => p.kind)).toEqual(["unknown-section"]);
    expect(caught?.message).not.toContain("missing-roles");
  });

  it("counts them across a set, which is what a host reports", () => {
    const problems = validateArticles(
      [
        articleWithoutRoles("one", "getting-started"),
        articleWithoutRoles("two", "getting-started"),
        withRoles("three"),
      ],
      config,
    );

    expect(problems.filter((p) => p.kind === "missing-roles")).toHaveLength(2);
  });
});
