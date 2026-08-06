import { parseArticle } from "../article.js";
import { ArticleParseError } from "../errors.js";

const doc = (frontmatter: string[], body = "Body."): string =>
  ["---", ...frontmatter, "---", "", body].join("\n");

describe("parseArticle", () => {
  it("reads the declared metadata and body", () => {
    const article = parseArticle(
      doc([
        "title: Inviting a teammate",
        "slug: inviting-a-teammate",
        "section: workspace",
        "order: 20",
        "summary: Adding and removing workspace members.",
        "roles: [Admin, Support]",
      ]),
      { sourcePath: "articles/workspace/inviting-a-teammate.md" },
    );

    expect(article.meta).toEqual({
      title: "Inviting a teammate",
      slug: "inviting-a-teammate",
      section: "workspace",
      order: 20,
      summary: "Adding and removing workspace members.",
      roles: ["Admin", "Support"],
    });
    expect(article.body).toBe("Body.");
    expect(article.sourcePath).toBe("articles/workspace/inviting-a-teammate.md");
  });

  it("defaults the slug to the file's basename", () => {
    const article = parseArticle(doc(["title: Access Reviews", "section: security"]), {
      sourcePath: "articles/security/access-reviews.md",
    });
    expect(article.meta.slug).toBe("access-reviews");
  });

  it("lowercases a slug derived from the filename", () => {
    // Filename case is a local convention; a slug is a URL. Measured against a
    // real hundred-article set, 29 files were named `PRD-0001-…` — every one of
    // them would otherwise have needed a rename or its own explicit `slug:`.
    const article = parseArticle(doc(["title: Widget display toggle", "section: prds"]), {
      sourcePath: "articles/prds/PRD-0001-widget-display-toggle.md",
    });
    expect(article.meta.slug).toBe("prd-0001-widget-display-toggle");
  });

  it("still rejects an explicit slug that is not lowercase", () => {
    // The default is a convenience for filenames. A slug an author wrote out by
    // hand is the URL they chose, and is held to the pattern.
    expect(() =>
      parseArticle(doc(["title: Notes", "section: features", "slug: PRD-0001"]), {
        sourcePath: "notes.md",
      }),
    ).toThrow(/must be lowercase letters, digits and single hyphens/);
  });

  it("defaults order to 0 and leaves summary and roles absent", () => {
    const article = parseArticle(doc(["title: Notes", "section: features"]), {
      sourcePath: "notes.md",
    });
    expect(article.meta.order).toBe(0);
    expect(article.meta.summary).toBeUndefined();
    expect(article.meta.roles).toBeUndefined();
  });

  it("accepts a single role written as a bare string", () => {
    const article = parseArticle(
      doc(["title: Exporting data", "section: exports", "roles: Editor"]),
      { sourcePath: "exporting-data.md" },
    );
    expect(article.meta.roles).toEqual(["Editor"]);
  });

  it("rejects an empty roles list rather than hiding the article from everyone", () => {
    // `roles: []` reads as "no restriction" to an author and means "nobody may
    // see this" to a set-membership check. The article then vanishes with no
    // error to explain it.
    expect(() =>
      parseArticle(doc(["title: Notes", "section: features", "roles: []"]), {
        sourcePath: "notes.md",
      }),
    ).toThrow(/omit it entirely/);
  });

  it("requires a title, naming the offending file", () => {
    expect(() =>
      parseArticle(doc(["section: features"]), { sourcePath: "articles/nameless.md" }),
    ).toThrow(/articles\/nameless\.md: frontmatter field `title` is required/);
  });

  it("requires a section", () => {
    expect(() => parseArticle(doc(["title: Notes"]), { sourcePath: "notes.md" })).toThrow(
      /`section` is required/,
    );
  });

  it("requires an explicit slug when there is no file to derive one from", () => {
    expect(() => parseArticle(doc(["title: Notes", "section: features"]))).toThrow(
      ArticleParseError,
    );
  });

  it("rejects a slug that would not survive being put in a URL", () => {
    for (const bad of ["Inviting a teammate", "notes_2", "trailing-", "Ünicode"]) {
      expect(() =>
        parseArticle(doc([`title: Notes`, "section: features", `slug: "${bad}"`]), {
          sourcePath: "notes.md",
        }),
      ).toThrow(/must be lowercase letters, digits and single hyphens/);
    }
  });

  it("rejects a non-numeric order", () => {
    expect(() =>
      parseArticle(doc(["title: Notes", "section: features", "order: first"]), {
        sourcePath: "notes.md",
      }),
    ).toThrow(/`order` must be a number/);
  });

  it("rejects a roles value that is not a list of strings", () => {
    expect(() =>
      parseArticle(doc(["title: Notes", "section: features", "roles: [1, 2]"]), {
        sourcePath: "notes.md",
      }),
    ).toThrow(/must be a list of strings/);
  });
});
