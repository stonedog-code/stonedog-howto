import {
  filterManifest,
  mappedRoleViewer,
  roleSetViewer,
  seesEverything,
  visibleArticles,
} from "../access";
import { buildManifest } from "../manifest";
import type { Article, HowToConfig } from "../types";

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

  // This assertion was inverted deliberately. It previously read `toBe(true)`,
  // encoding "an article with no roles is readable by everyone".
  //
  // That default is what makes a forgotten field dangerous: an article naming
  // no audience has said nothing, not "everyone", and the usual cause is that
  // the author omitted it. Under the old default the one article nobody
  // finished was the one article everybody could read — and nobody reports
  // being shown too much, so the mistake never surfaced.
  //
  // Denying points the failure at the direction that reports itself: the
  // article disappears and somebody asks where it went.
  it("refuses an article that names no roles, by default", () => {
    expect(roleSetViewer({ roles: [] }).canSee(undefined)).toBe(false);
    expect(roleSetViewer({ roles: ["Editor"] }).canSee(undefined)).toBe(false);
  });

  it("can be told to grant them, for a reader trusted to fix them", () => {
    const viewer = roleSetViewer({ roles: ["Editor"], unrestricted: "allow" });
    expect(viewer.canSee(undefined)).toBe(true);
    expect(viewer.canSee(["Editor"])).toBe(true);
  });

  it("still refuses a role the reader does not hold, however unrestricted", () => {
    const viewer = roleSetViewer({ roles: ["Editor"], unrestricted: "allow" });
    expect(viewer.canSee(["Owner"])).toBe(false);
  });
});

describe("mappedRoleViewer", () => {
  it("grants the article roles its mapping names for a role the reader holds", () => {
    const viewer = mappedRoleViewer({
      viewerRoles: ["Editor"],
      mapping: { Editor: ["Contributor", "Reviewer"] },
    });
    expect(viewer.canSee(["Contributor"])).toBe(true);
    expect(viewer.canSee(["Reviewer"])).toBe(true);
    expect(viewer.canSee(["Owner"])).toBe(false);
  });

  it("unions the grants of every role the reader holds", () => {
    const viewer = mappedRoleViewer({
      viewerRoles: ["Editor", "Auditor"],
      mapping: { Editor: ["Contributor"], Auditor: ["Reviewer"] },
    });
    expect(viewer.canSee(["Contributor"])).toBe(true);
    expect(viewer.canSee(["Reviewer"])).toBe(true);
  });

  // The load-bearing property. A mapping mistake must hide articles, never
  // reveal them: the reader who cannot find something complains, and nobody
  // complains about being shown too much.
  it("denies a role the mapping does not mention", () => {
    const viewer = mappedRoleViewer({
      viewerRoles: ["Editor"],
      mapping: { Editor: ["Contributor"] },
    });
    expect(viewer.canSee(["Unmapped"])).toBe(false);
  });

  it("denies everything when the reader's roles are absent from the mapping", () => {
    const viewer = mappedRoleViewer({
      viewerRoles: ["Stranger"],
      mapping: { Editor: ["Contributor"] },
    });
    expect(viewer.canSee(["Contributor"])).toBe(false);
    expect(viewer.canSee(["Stranger"])).toBe(false);
  });

  it("denies everything on an empty mapping", () => {
    const viewer = mappedRoleViewer({ viewerRoles: ["Editor"], mapping: {} });
    expect(viewer.canSee(["Contributor"])).toBe(false);
    expect(viewer.canSee(undefined)).toBe(false);
  });

  // No "fall back to matching names directly" mode: it is convenient exactly
  // until two vocabularies share a word, which is when it is most dangerous.
  it("does not grant an article role merely because the reader holds that name", () => {
    const viewer = mappedRoleViewer({
      viewerRoles: ["Admin"],
      mapping: { Admin: ["Contributor"] },
    });
    expect(viewer.canSee(["Admin"])).toBe(false);
  });

  it("grants every article role when the mapping says `*`", () => {
    const viewer = mappedRoleViewer({
      viewerRoles: ["Owner"],
      mapping: { Owner: "*" },
    });
    expect(viewer.canSee(["Contributor"])).toBe(true);
    expect(viewer.canSee(["Anything At All"])).toBe(true);
  });

  // `*` grants every role. An article with no roles has no role to grant — its
  // problem is that it is unfinished, not that it is exclusive.
  it("does not let `*` also grant articles that name no roles", () => {
    const viewer = mappedRoleViewer({
      viewerRoles: ["Owner"],
      mapping: { Owner: "*" },
    });
    expect(viewer.canSee(undefined)).toBe(false);
  });

  it("refuses articles naming no roles by default, and grants them on request", () => {
    const mapping = { Editor: ["Contributor"] };
    expect(
      mappedRoleViewer({ viewerRoles: ["Editor"], mapping }).canSee(undefined),
    ).toBe(false);
    expect(
      mappedRoleViewer({ viewerRoles: ["Editor"], mapping, unrestricted: "allow" }).canSee(
        undefined,
      ),
    ).toBe(true);
  });

  // A mapping is host data, often out of a database. A role named after
  // something on Object.prototype must not resolve to a grant.
  it("treats inherited object properties as absent, not as grants", () => {
    const viewer = mappedRoleViewer({
      viewerRoles: ["constructor", "toString", "__proto__"],
      mapping: { Editor: ["Contributor"] },
    });
    expect(viewer.canSee(["Contributor"])).toBe(false);
    expect(viewer.canSee(["anything"])).toBe(false);
  });
});

describe("visibleArticles", () => {
  it("keeps only what the reader may see, in the given order", () => {
    const articles = [
      article("welcome", "public", ["Everyone"]),
      article("access-reviews", "security", ["Owner"]),
      article("support-guide", "admin", ["Support"]),
    ];

    const visible = visibleArticles(
      articles,
      roleSetViewer({ roles: ["Everyone", "Support"] }),
    );
    expect(visible.map((a) => a.meta.slug)).toEqual(["welcome", "support-guide"]);
  });
});

describe("filterManifest", () => {
  const manifest = buildManifest(
    [
      article("welcome", "public", ["Everyone"]),
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
    const filtered = filterManifest(manifest, roleSetViewer({ roles: ["Everyone"] }));
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
