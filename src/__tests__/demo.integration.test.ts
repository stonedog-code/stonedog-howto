import { buildPayload, config, readArticles } from "../../demo/server/howto";
import { VIEWER_IDS, VIEWERS } from "../../demo/shared/viewers";
import { buildManifest } from "../manifest";

/**
 * The demo is a claim, so it is tested like one.
 *
 * It is the worked example a consumer copies from, and the README points at it
 * as the way to check the package's central promise rather than take it on
 * trust. An example that has quietly stopped being true is worse than no
 * example, and nothing else in the gate reads `demo/` at all: a renamed section
 * id, a mistyped role, or an article whose frontmatter no longer parses would
 * otherwise be found by whoever next ran `npm run dev`.
 *
 * This calls the demo server's own `buildPayload`, not a reimplementation of
 * it, so what is asserted here is what the browser is actually sent.
 */

function payloadFor(viewer: (typeof VIEWER_IDS)[number], overrides: { unrestricted?: boolean } = {}) {
  return buildPayload({
    viewerId: viewer,
    // Defaults to false, matching the package's own default and the demo's
    // initial state: an article naming no audience is readable by nobody.
    seesUnrestricted: overrides.unrestricted ?? false,
    query: "",
  });
}

describe("the demo's articles", () => {
  it("all parse, and every section they name exists in the config", () => {
    // `buildManifest` throws if an article names a section that was not
    // declared, if two share a slug, or if a section id is declared twice.
    // Adding an article to a directory nobody added to `config.sections` is the
    // easy mistake, and this is where it surfaces.
    const manifest = buildManifest(readArticles(), config);
    expect(manifest.bySlug.size).toBe(8);
  });

  it("takes each article's section from its directory", () => {
    const bySlug = new Map(readArticles().map((a) => [a.meta.slug, a]));

    expect(bySlug.get("welcome")?.meta.section).toBe("getting-started");
    expect(bySlug.get("saving-your-work")?.meta.section).toBe("using-the-surface");
    // Nested directories join with a hyphen.
    expect(bySlug.get("invoices")?.meta.section).toBe("administration-billing");
  });

  it("lets a declared section beat the directory the file sits in", () => {
    // `where-this-article-lives.md` is on disk under `using-the-surface/` and
    // declares `section: getting-started`. This is the whole point of that
    // article, so if it ever stops being true the article becomes a lie.
    const article = readArticles().find((a) => a.sourcePath?.includes("where-this-article-lives"));

    expect(article?.sourcePath).toContain("using-the-surface");
    expect(article?.meta.section).toBe("getting-started");
  });
});

describe("what each viewer is sent", () => {
  it("gives every viewer strictly more than the one below it", () => {
    const counts = VIEWER_IDS.map((id) => payloadFor(id).stats.visible);
    expect(counts).toEqual([4, 5, 7]);
  });

  it("withholds the administration articles from a Guest entirely", () => {
    const guest = payloadFor("guest");

    // Not merely absent from the navigation — absent from the payload. The
    // sidebar is a rendering decision; this is the wire.
    const serialised = JSON.stringify(guest);
    expect(serialised).not.toContain("managing-members");
    expect(serialised).not.toContain("Invoices and receipts");
    expect(serialised).not.toContain("credit note");
  });

  it("prunes a section a viewer can open nothing inside, rather than emptying it", () => {
    // An empty section's title still tells a reader that a subject exists which
    // they are not entitled to know about.
    expect(payloadFor("guest").sections.map((s) => s.id)).toEqual([
      "getting-started",
      "using-the-surface",
    ]);
    expect(payloadFor("admin").sections.map((s) => s.id)).toContain("administration");
  });

  it("keeps the nested Billing section under Administration for an Admin", () => {
    const administration = payloadFor("admin").sections.find((s) => s.id === "administration");

    expect(administration?.children.map((c) => c.id)).toEqual(["administration-billing"]);
    expect(administration?.children[0]?.articleSlugs).toEqual(["invoices"]);
  });

  it("hides the article naming no roles from everyone, including an Admin", () => {
    // The demo carries exactly one such article, deliberately. Under the
    // default policy nobody can open it — not even the most privileged viewer,
    // because it entitles nobody rather than entitling somebody senior.
    for (const id of VIEWER_IDS) {
      const slugs = payloadFor(id).articles.map((a) => a.slug);
      expect(slugs).not.toContain("an-article-that-forgot-its-roles");
    }
  });

  it("reveals it only when the host opts in, and says so in the stats", () => {
    const before = payloadFor("guest");
    const after = payloadFor("guest", { unrestricted: true });

    expect(after.stats.visible).toBe(before.stats.visible + 1);
    expect(after.articles.map((a) => a.slug)).toContain(
      "an-article-that-forgot-its-roles",
    );
  });

  it("counts the articles missing roles regardless of who is looking", () => {
    // The count is a property of the content, not of the reader — a Guest who
    // cannot open the article is still told one exists to be fixed.
    for (const id of VIEWER_IDS) {
      expect(payloadFor(id).stats.missingRoles).toBe(1);
    }
  });

  it("never returns a search result for an article the viewer may not open", () => {
    // Filtering happens before matching, so the count itself discloses nothing.
    const asGuest = buildPayload({ viewerId: "guest", seesUnrestricted: true, query: "invoice" });
    const asAdmin = buildPayload({ viewerId: "admin", seesUnrestricted: true, query: "invoice" });

    expect(asGuest.results).toEqual([]);
    expect(asAdmin.results?.map((r) => r.slug)).toEqual(["invoices"]);
  });
});

describe("the demo's viewers", () => {
  it("grants each viewer the roles of the one below it", () => {
    // The demo's own hierarchy, built by accumulating set membership rather than
    // by ordering the names. If this stops holding, the switcher stops
    // demonstrating a hierarchy and starts demonstrating three unrelated sets.
    expect(VIEWERS.guest.roles).toEqual(["Guest"]);
    expect(VIEWERS.user.roles).toEqual(expect.arrayContaining(VIEWERS.guest.roles));
    expect(VIEWERS.admin.roles).toEqual(expect.arrayContaining(VIEWERS.user.roles));
  });
});
