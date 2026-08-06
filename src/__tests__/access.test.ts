import { filterManifest, roleSetViewer, seesEverything, visibleArticles } from "../access.js";
import { buildManifest } from "../manifest.js";
import type { Article, HowToConfig } from "../types.js";

const article = (slug: string, section: string, roles?: string[]): Article => ({
  meta: {
    title: slug,
    slug,
    section,
    order: 0,
    ...(roles !== undefined ? { roles } : {}),
  },
  body: "Body.",
});

const config: HowToConfig = {
  sections: [
    { id: "public", title: "Everyone" },
    {
      id: "admin",
      title: "Administration",
      children: [{ id: "security", title: "Security" }],
    },
  ],
};

describe("roleSetViewer", () => {
  it("grants an article when the reader holds one of its roles", () => {
    const viewer = roleSetViewer({ roles: ["Support"] });
    expect(viewer.canSee(["Admin", "Support"])).toBe(true);
    expect(viewer.canSee(["Admin"])).toBe(false);
  });

  it("grants unrestricted articles by default", () => {
    expect(roleSetViewer({ roles: [] }).canSee(undefined)).toBe(true);
  });

  it("can be told to withhold unrestricted articles too", () => {
    const viewer = roleSetViewer({ roles: ["Editor"], seesUnrestricted: false });
    expect(viewer.canSee(undefined)).toBe(false);
    expect(viewer.canSee(["Editor"])).toBe(true);
  });
});

describe("visibleArticles", () => {
  it("keeps only what the reader may see, in the given order", () => {
    const articles = [
      article("welcome", "public"),
      article("access-reviews", "security", ["Owner"]),
      article("support-guide", "admin", ["Support"]),
    ];

    const visible = visibleArticles(articles, roleSetViewer({ roles: ["Support"] }));
    expect(visible.map((a) => a.meta.slug)).toEqual(["welcome", "support-guide"]);
  });
});

describe("filterManifest", () => {
  const manifest = buildManifest(
    [
      article("welcome", "public"),
      article("support-guide", "admin", ["Support"]),
      article("access-reviews", "security", ["Owner"]),
    ],
    config,
  );

  it("leaves everything in place for a reader who sees everything", () => {
    const filtered = filterManifest(manifest, seesEverything);
    expect(filtered.sections).toHaveLength(2);
    expect(filtered.bySlug.size).toBe(3);
  });

  it("prunes a section whose every article is hidden", () => {
    // An empty section is not tidy, it is a disclosure: the title alone tells a
    // reader that a subject exists which they are not entitled to know about.
    const filtered = filterManifest(manifest, roleSetViewer({ roles: [] }));
    expect(filtered.sections.map((s) => s.id)).toEqual(["public"]);
  });

  it("keeps a parent section that still has a visible child section", () => {
    const filtered = filterManifest(manifest, roleSetViewer({ roles: ["Owner"] }));
    const admin = filtered.sections.find((s) => s.id === "admin");
    expect(admin?.articles).toEqual([]);
    expect(admin?.children.map((c) => c.id)).toEqual(["security"]);
  });

  it("prunes the slug index too, so a direct route lookup cannot bypass the nav", () => {
    // Filtering only the navigation is the classic hole: the article is gone
    // from the sidebar and still served to anyone who guesses the URL.
    const filtered = filterManifest(manifest, roleSetViewer({ roles: ["Support"] }));
    expect(filtered.bySlug.get("support-guide")).toBeDefined();
    expect(filtered.bySlug.get("access-reviews")).toBeUndefined();
  });

  it("does not mutate the manifest it was given", () => {
    filterManifest(manifest, roleSetViewer({ roles: [] }));
    expect(manifest.sections).toHaveLength(2);
    expect(manifest.bySlug.size).toBe(3);
  });
});
