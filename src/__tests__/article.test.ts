import { parseArticle } from "../article";
import { ArticleParseError } from "../errors";

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

/**
 * Unknown frontmatter keys (NEH-470).
 *
 * The parser used to read its six keys and ignore everything else, so `sumary:`
 * parsed cleanly, produced an article with no summary, and reported nothing.
 *
 * The reason this is not filed as a cosmetic typo bug: three of the six fail
 * invisibly when misspelled, and one of those three fails towards DISCLOSURE.
 * `role: [Admin]` states an audience the parser discarded, so the article was
 * readable by everyone — an access-control defect with nothing failing
 * anywhere.
 */
describe("parseArticle — unknown frontmatter keys", () => {
  const base = ["title: Notes", "section: features"];

  it("rejects a misspelled summary rather than dropping it", () => {
    expect(() =>
      parseArticle(doc([...base, "sumary: A note about notes."]), {
        sourcePath: "notes.md",
      }),
    ).toThrow(/unknown frontmatter key `sumary`/);
  });

  it("suggests the key that was meant", () => {
    // A bare "unknown key" is correct and nearly useless at 3am. The suggestion
    // is the difference between a fixed typo and a deleted line.
    expect(() =>
      parseArticle(doc([...base, "sumary: x"]), { sourcePath: "notes.md" }),
    ).toThrow(/did you mean `summary`\?/);
    expect(() =>
      parseArticle(doc([...base, "oder: 3"]), { sourcePath: "notes.md" }),
    ).toThrow(/did you mean `order`\?/);
  });

  it("catches the roles misspellings, which are the access-control ones", () => {
    // `role` (singular) and `Roles` (capitalised) are the two most natural ways
    // to get this wrong, and both previously published the article to everyone.
    for (const bad of ["role: [Admin]", "Roles: [Admin]", "rolls: [Admin]"]) {
      expect(() =>
        parseArticle(doc([...base, bad]), { sourcePath: "notes.md" }),
      ).toThrow(/did you mean `roles`\?/);
    }
  });

  it("names the file, like every other failure here", () => {
    // The whole argument for self-describing articles is that a problem is
    // traceable to one file. An error saying only "unknown key" is useless
    // across a hundred of them.
    expect(() =>
      parseArticle(doc([...base, "sumary: x"]), {
        sourcePath: "articles/features/notes.md",
      }),
    ).toThrow(/^articles\/features\/notes\.md: /);
  });

  it("throws ArticleParseError, so a host catches it with everything else", () => {
    expect(() =>
      parseArticle(doc([...base, "sumary: x"]), { sourcePath: "notes.md" }),
    ).toThrow(ArticleParseError);
  });

  it("allows host metadata under an x- prefix, and does not carry it onto meta", () => {
    // Without somewhere to put its own metadata a host cannot use this package
    // at all. Reading the values would make their schema our problem; the point
    // is only that declaring one is not an error.
    const article = parseArticle(
      doc([...base, "x-owner: platform-team", "x-review-due: 2027-01-01"]),
      { sourcePath: "notes.md" },
    );
    expect(article.meta.title).toBe("Notes");
    expect(Object.keys(article.meta).sort()).toEqual(["order", "section", "slug", "title"]);
  });

  it("still catches a typo of a known field, x- prefix notwithstanding", () => {
    // The escape hatch has to stay narrow or it defeats the check. "Allow any
    // unknown key" would have been the easy version and would let `sumary`
    // straight back through.
    expect(() =>
      parseArticle(doc([...base, "sumary: x", "x-owner: platform-team"]), {
        sourcePath: "notes.md",
      }),
    ).toThrow(/unknown frontmatter key `sumary`/);
  });

  it("lists the known keys when nothing is close enough to suggest", () => {
    // A wrong suggestion is worse than none — it invites a second wrong edit —
    // so an unrelated key gets the full list instead of a nearest match.
    expect(() =>
      parseArticle(doc([...base, "publishedAt: 2026-01-01"]), {
        sourcePath: "notes.md",
      }),
    ).toThrow(/Known keys are `title`, `slug`, `section`, `order`, `summary`, `roles`/);
  });

  it("reports the unknown key before a missing required field", () => {
    // Ordering matters: the typo is the surprising failure and the one an
    // author cannot see by reading their own file. Reporting the missing title
    // first would send them to fix a field they did in fact write.
    expect(() =>
      parseArticle(doc(["section: features", "titel: Notes"]), {
        sourcePath: "notes.md",
      }),
    ).toThrow(/unknown frontmatter key `titel`/);
  });

  it("accepts every known key together, so the guard cannot be over-eager", () => {
    // The failure mode of a strict check is rejecting something valid, which is
    // worse than what it fixes. This is the full legal set in one file.
    expect(() =>
      parseArticle(
        doc([
          "title: Notes",
          "slug: notes",
          "section: features",
          "order: 3",
          "summary: About notes.",
          "roles: [Admin]",
        ]),
        { sourcePath: "notes.md" },
      ),
    ).not.toThrow();
  });
});
