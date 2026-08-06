import { ArticleParseError } from "../errors";
import { splitFrontmatter } from "../frontmatter";

describe("splitFrontmatter", () => {
  it("splits a fenced YAML block off the front", () => {
    const { data, body } = splitFrontmatter(
      ["---", "title: Inviting a teammate", "order: 20", "---", "", "Body text."].join("\n"),
    );

    expect(data).toEqual({ title: "Inviting a teammate", order: 20 });
    expect(body).toBe("Body text.");
  });

  it("treats a document with no fence as all body", () => {
    const { data, body } = splitFrontmatter("# Just a heading\n\nProse.");
    expect(data).toEqual({});
    expect(body).toBe("# Just a heading\n\nProse.");
  });

  it("does not let a horizontal rule in the body close the frontmatter late", () => {
    // The bug this pins: searching for the LAST `---` rather than the next one
    // swallows the entire article into its own frontmatter, and the article
    // renders as an empty page with no error anywhere.
    const { data, body } = splitFrontmatter(
      ["---", "title: Sharing", "---", "", "Intro.", "", "---", "", "After the rule."].join("\n"),
    );

    expect(data).toEqual({ title: "Sharing" });
    expect(body).toBe("Intro.\n\n---\n\nAfter the rule.");
  });

  it("handles CRLF line endings", () => {
    const { data, body } = splitFrontmatter("---\r\ntitle: Notes\r\n---\r\n\r\nBody.\r\n");
    expect(data).toEqual({ title: "Notes" });
    expect(body).toBe("Body.\n");
  });

  it("handles a leading byte-order mark", () => {
    const { data } = splitFrontmatter("﻿---\ntitle: Notes\n---\n\nBody.");
    expect(data).toEqual({ title: "Notes" });
  });

  it("reads an empty frontmatter block as no metadata", () => {
    const { data, body } = splitFrontmatter("---\n---\n\nBody.");
    expect(data).toEqual({});
    expect(body).toBe("Body.");
  });

  it("parses YAML lists, quoted strings, and colons inside values", () => {
    const { data } = splitFrontmatter(
      [
        "---",
        'title: "Sharing: what a link exposes"',
        "roles: [Admin, Support]",
        "---",
        "",
        "Body.",
      ].join("\n"),
    );

    expect(data["title"]).toBe("Sharing: what a link exposes");
    expect(data["roles"]).toEqual(["Admin", "Support"]);
  });

  it("throws when the block is opened but never closed", () => {
    expect(() => splitFrontmatter("---\ntitle: Notes\n\nBody.", "articles/notes.md")).toThrow(
      ArticleParseError,
    );
    expect(() => splitFrontmatter("---\ntitle: Notes\n\nBody.", "articles/notes.md")).toThrow(
      /articles\/notes\.md/,
    );
  });

  it("throws on invalid YAML, naming the file", () => {
    expect(() =>
      splitFrontmatter("---\ntitle: [unclosed\n---\n\nBody.", "articles/broken.md"),
    ).toThrow(/articles\/broken\.md: frontmatter is not valid YAML/);
  });

  it("rejects a frontmatter block that is a list rather than key/value pairs", () => {
    expect(() => splitFrontmatter("---\n- one\n- two\n---\n\nBody.")).toThrow(
      /key\/value pairs/,
    );
  });
});
