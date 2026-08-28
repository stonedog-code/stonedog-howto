import { parseConfig } from "../config";
import { reconcile, type KnownRepo } from "../reconcile";

const known = (over: Partial<KnownRepo> = {}): KnownRepo => ({
  id: "r1",
  name: "Hopperguard",
  path: "/src/hg/articles",
  status: "Active",
  isConfigured: true,
  ...over,
});

describe("parseConfig", () => {
  it("reads the entries it understands", () => {
    const { repos, problems } = parseConfig(
      JSON.stringify({ repos: [{ name: "Hopperguard", path: "/src/hg" }] }),
    );
    expect(repos).toEqual([{ name: "Hopperguard", path: "/src/hg" }]);
    expect(problems).toEqual([]);
  });

  // One typo must not take every repository offline, so a bad entry is reported
  // and the good ones still load.
  it("reports a bad entry by index and keeps the good ones", () => {
    const { repos, problems } = parseConfig(
      JSON.stringify({
        repos: [{ name: "Good", path: "/a" }, { path: "/b" }, { name: "AlsoGood", path: "/c" }],
      }),
    );

    expect(repos.map((r) => r.name)).toEqual(["Good", "AlsoGood"]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ index: 1 });
  });

  // The name is the identity that mappings are keyed on. Two entries claiming
  // it would make somebody's permissions belong to whichever won.
  it("refuses a duplicate name, naming both entries", () => {
    const { repos, problems } = parseConfig(
      JSON.stringify({ repos: [{ name: "Dup", path: "/a" }, { name: "Dup", path: "/b" }] }),
    );

    expect(repos).toHaveLength(1);
    expect(problems[0]?.message).toMatch(/declared twice/);
  });

  it("reports malformed JSON rather than throwing", () => {
    const { repos, problems } = parseConfig("{ not json");
    expect(repos).toEqual([]);
    expect(problems[0]?.message).toMatch(/not valid JSON/);
  });

  it("refuses a file that is not shaped like a config", () => {
    expect(parseConfig(JSON.stringify(["a"])).problems).toHaveLength(1);
    expect(parseConfig(JSON.stringify({ repositories: [] })).problems).toHaveLength(1);
  });

  // The three ways a single entry can be unusable. Each was reachable and
  // untested: a config file is edited by hand, so these are the paths a real
  // mistake takes, and a reporter nobody exercises is a reporter that can
  // report the wrong index without anybody noticing.
  it("reports an entry that is not an object at all", () => {
    const { repos, problems } = parseConfig(
      JSON.stringify({ repos: [{ name: "Good", path: "/a" }, "just-a-string", null] }),
    );

    expect(repos.map((r) => r.name)).toEqual(["Good"]);
    expect(problems.map((p) => p.index)).toEqual([1, 2]);
    expect(problems[0]?.message).toMatch(/is not an object/);
  });

  it("reports an entry with a name and no path, naming the repository", () => {
    const { repos, problems } = parseConfig(JSON.stringify({ repos: [{ name: "Orphan" }] }));

    expect(repos).toEqual([]);
    // Named rather than numbered: the operator knows which repository they
    // meant, and an index alone means counting entries in a file by hand.
    expect(problems[0]?.message).toMatch(/`Orphan` has no `path`/);
  });

  it("treats a whitespace-only name or path as absent", () => {
    // `"  "` is a string, so a truthiness check would accept it and produce a
    // repository whose identity is a space -- which then becomes the key a
    // role mapping is stored under.
    expect(parseConfig(JSON.stringify({ repos: [{ name: "   ", path: "/a" }] })).problems)
      .toHaveLength(1);
    expect(parseConfig(JSON.stringify({ repos: [{ name: "A", path: "  " }] })).problems)
      .toHaveLength(1);
  });

  it("treats a non-string name or path as absent rather than coercing it", () => {
    const { problems } = parseConfig(JSON.stringify({ repos: [{ name: 7, path: ["/a"] }] }));
    expect(problems[0]?.message).toMatch(/has no `name`/);
  });
});

describe("reconcile", () => {
  it("syncs a repository that is configured and present", () => {
    const { actions } = reconcile([{ name: "Hopperguard", path: "/src/hg/articles" }], [known()]);
    expect(actions).toEqual([
      { kind: "sync", name: "Hopperguard", path: "/src/hg/articles", id: "r1" },
    ]);
  });

  // Content nobody has mapped is content nobody has decided about, and the safe
  // state for an undecided article is not to be in the portal at all.
  it("adopts a new repository WITHOUT syncing it", () => {
    const { actions } = reconcile([{ name: "Rozcards", path: "/src/rc" }], []);
    expect(actions).toEqual([{ kind: "adopt", name: "Rozcards", path: "/src/rc" }]);
  });

  it("still refuses to sync a known repository nobody has mapped", () => {
    const { actions } = reconcile(
      [{ name: "Hopperguard", path: "/src/hg/articles" }],
      [known({ isConfigured: false })],
    );
    expect(actions[0]?.kind).toBe("adopt");
  });

  // Dormant, not deleted: a typo in a config file must not destroy a mapping
  // somebody built by hand.
  it("makes a repository dormant when the config stops naming it", () => {
    const { actions } = reconcile([], [known()]);
    expect(actions).toEqual([{ kind: "dormant", name: "Hopperguard", id: "r1" }]);
  });

  it("does not repeat itself for an already-dormant repository", () => {
    expect(reconcile([], [known({ status: "Dormant" })]).actions).toEqual([]);
  });

  it("restores a dormant repository when its name comes back", () => {
    const { actions } = reconcile(
      [{ name: "Hopperguard", path: "/src/hg/articles" }],
      [known({ status: "Dormant" })],
    );
    expect(actions[0]).toMatchObject({ kind: "sync", id: "r1" });
  });

  // A mapping is attached to a NAME. Following a path change silently would
  // apply somebody's carefully chosen permissions to articles they have never
  // seen.
  it("refuses to follow a path change, and says so", () => {
    const { actions, notes } = reconcile(
      [{ name: "Hopperguard", path: "/src/somewhere-else" }],
      [known()],
    );

    expect(actions).toEqual([
      {
        kind: "path-changed",
        name: "Hopperguard",
        id: "r1",
        from: "/src/hg/articles",
        to: "/src/somewhere-else",
      },
    ]);
    expect(notes[0]).toMatch(/re-confirm/);
  });

  it("adopts a path for a repository that has never had one", () => {
    const { actions } = reconcile(
      [{ name: "Hopperguard", path: "/src/hg/articles" }],
      [known({ path: null, isConfigured: false })],
    );
    expect(actions[0]).toMatchObject({ kind: "adopt", path: "/src/hg/articles" });
  });

  it("handles several repositories in different states at once", () => {
    const { actions } = reconcile(
      [
        { name: "Hopperguard", path: "/src/hg/articles" },
        { name: "Rozcards", path: "/src/rc" },
      ],
      [known(), known({ id: "r9", name: "Optima", path: "/src/op" })],
    );

    expect(actions.map((a) => `${a.kind}:${a.name}`).sort()).toEqual([
      "adopt:Rozcards",
      "dormant:Optima",
      "sync:Hopperguard",
    ]);
  });
});
