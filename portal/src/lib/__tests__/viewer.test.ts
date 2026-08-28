import { ROLES } from "../capabilities";
import type { PortalUser } from "../rbac";
import { grantedSourceRoles, viewerForRepo, type RepoRoleMapping } from "../viewer";

const HG = "hopperguard";
const RC = "rozcards";

// `isSystemAdmin` is kept as the parameter so every existing case below still
// says what it always said. It now selects an account ROLE rather than setting
// a flag -- the two express the same thing for these tests, and `accountRole`
// is what the subject is actually built from.
const user = (grants: PortalUser["grants"], isSystemAdmin = false): PortalUser => ({
  id: "u1",
  accountRole: isSystemAdmin ? "SystemAdmin" : "Reader",
  grants,
});

const map = (
  role: RepoRoleMapping["role"],
  sourceRoles: string[],
  extra: Partial<RepoRoleMapping> = {},
): RepoRoleMapping => ({
  role,
  sourceRoles,
  allSourceRoles: false,
  seesUnclassified: false,
  ...extra,
});

describe("viewerForRepo", () => {
  it("grants the source roles the mapping names for a role the reader holds", () => {
    const reader = user([{ role: ROLES.Reader, repoId: HG }]);
    const viewer = viewerForRepo(reader, HG, [
      map(ROLES.Reader, ["Facility Admin", "Organization Admin"]),
    ]);

    expect(viewer.canSee(["Facility Admin"])).toBe(true);
    expect(viewer.canSee(["Organization Admin"])).toBe(true);
  });

  // The property everything else rests on. A mapping mistake must hide
  // articles, never reveal them: the reader who cannot find one complains, and
  // nobody complains about being shown too much.
  it("denies a source role the mapping does not name", () => {
    const reader = user([{ role: ROLES.Reader, repoId: HG }]);
    const viewer = viewerForRepo(reader, HG, [map(ROLES.Reader, ["Facility Admin"])]);

    expect(viewer.canSee(["Artwork Admin"])).toBe(false);
    expect(viewer.canSee(["System Admin"])).toBe(false);
  });

  it("denies everything when the repository has no mapping at all", () => {
    const reader = user([{ role: ROLES.Reader, repoId: HG }]);
    const viewer = viewerForRepo(reader, HG, []);

    expect(viewer.canSee(["Facility Admin"])).toBe(false);
    expect(viewer.canSee(undefined)).toBe(false);
  });

  // Order matters: the grant is checked before the mapping, so a mapping row
  // cannot resurrect access a grant never gave.
  it("denies everything in a repository the reader was not granted", () => {
    const reader = user([{ role: ROLES.Reader, repoId: HG }]);
    const viewer = viewerForRepo(reader, RC, [map(ROLES.Reader, ["Facility Admin"])]);

    expect(viewer.canSee(["Facility Admin"])).toBe(false);
    expect(viewer.canSee(undefined)).toBe(false);
  });

  it("uses only the rows for roles the reader actually holds", () => {
    const guest = user([{ role: ROLES.Guest, repoId: HG }]);
    const viewer = viewerForRepo(guest, HG, [
      map(ROLES.Guest, ["Family Member"]),
      map(ROLES.Reader, ["Facility Admin"]),
      map(ROLES.AccountAdmin, ["System Admin"]),
    ]);

    expect(viewer.canSee(["Family Member"])).toBe(true);
    expect(viewer.canSee(["Facility Admin"])).toBe(false);
    expect(viewer.canSee(["System Admin"])).toBe(false);
  });

  it("unions the rows when the reader holds several roles in one repository", () => {
    const both = user([
      { role: ROLES.Guest, repoId: HG },
      { role: ROLES.Reader, repoId: HG },
    ]);
    const viewer = viewerForRepo(both, HG, [
      map(ROLES.Guest, ["Family Member"]),
      map(ROLES.Reader, ["Facility Admin"]),
    ]);

    expect(viewer.canSee(["Family Member"])).toBe(true);
    expect(viewer.canSee(["Facility Admin"])).toBe(true);
  });

  it("grants every source role when the row says so", () => {
    const reader = user([{ role: ROLES.Reader, repoId: HG }]);
    const viewer = viewerForRepo(reader, HG, [
      map(ROLES.Reader, [], { allSourceRoles: true }),
    ]);

    expect(viewer.canSee(["Facility Admin"])).toBe(true);
    expect(viewer.canSee(["a role added next week"])).toBe(true);
  });

  // The portal's whole reason for existing: one person, different rights in
  // each product's documentation.
  it("gives one person different reach in different repositories", () => {
    const mixed = user([
      { role: ROLES.Reader, repoId: HG },
      { role: ROLES.Reader, repoId: RC },
    ]);
    const hgMappings = [map(ROLES.Reader, ["Facility Admin"])];
    const rcMappings = [map(ROLES.Reader, [], { allSourceRoles: true })];

    expect(viewerForRepo(mixed, HG, hgMappings).canSee(["Facility Admin"])).toBe(true);
    expect(viewerForRepo(mixed, HG, hgMappings).canSee(["Artwork Admin"])).toBe(false);
    expect(viewerForRepo(mixed, RC, rcMappings).canSee(["Artwork Admin"])).toBe(true);
  });
});

describe("articles that declare no roles", () => {
  const reader = user([{ role: ROLES.Reader, repoId: HG }]);

  it("reach nobody by default, however much else they are granted", () => {
    const viewer = viewerForRepo(reader, HG, [
      map(ROLES.Reader, [], { allSourceRoles: true }),
    ]);

    // `allSourceRoles` grants every ROLE. An article with no roles has no role
    // to be granted -- its problem is that it is unfinished, not that it is
    // exclusive -- so this must stay false.
    expect(viewer.canSee(["anything"])).toBe(true);
    expect(viewer.canSee(undefined)).toBe(false);
  });

  it("reach a role whose row opts in", () => {
    const viewer = viewerForRepo(reader, HG, [
      map(ROLES.Reader, ["Facility Admin"], { seesUnclassified: true }),
    ]);
    expect(viewer.canSee(undefined)).toBe(true);
  });

  it("do NOT leak from another role's row", () => {
    // The row that opts in belongs to AccountAdmin; this reader is not one.
    const viewer = viewerForRepo(reader, HG, [
      map(ROLES.Reader, ["Facility Admin"]),
      map(ROLES.AccountAdmin, ["System Admin"], { seesUnclassified: true }),
    ]);
    expect(viewer.canSee(undefined)).toBe(false);
  });

  it("always reach the system admin, who is expected to fix them", () => {
    const operator = user([], true);
    expect(viewerForRepo(operator, HG, []).canSee(undefined)).toBe(true);
  });
});

describe("the system admin", () => {
  const operator = user([], true);

  it("reads everything in every repository, with no mapping configured", () => {
    const viewer = viewerForRepo(operator, HG, []);

    expect(viewer.canSee(["System Admin"])).toBe(true);
    expect(viewer.canSee(["a role nobody has mapped"])).toBe(true);
    expect(viewer.canSee(undefined)).toBe(true);
  });

  it("is not reached by inventing a mapping row for them", () => {
    // `portalRolesInRepo` returns nothing for an operator, so a mapping-shaped
    // bypass would render on the mapping screen as though an admin had
    // configured it. The reach is answered from the capability instead.
    expect(grantedSourceRoles(operator, HG, [])).toBe("*");
  });
});

describe("grantedSourceRoles", () => {
  it("lists what a reader's rows resolve to, sorted and deduplicated", () => {
    const both = user([
      { role: ROLES.Guest, repoId: HG },
      { role: ROLES.Reader, repoId: HG },
    ]);

    expect(
      grantedSourceRoles(both, HG, [
        map(ROLES.Reader, ["Organization Admin", "Facility Admin"]),
        map(ROLES.Guest, ["Facility Admin", "Family Member"]),
      ]),
    ).toEqual(["Facility Admin", "Family Member", "Organization Admin"]);
  });

  it("returns `*` rather than enumerating names the mapping never listed", () => {
    const reader = user([{ role: ROLES.Reader, repoId: HG }]);
    expect(
      grantedSourceRoles(reader, HG, [map(ROLES.Reader, [], { allSourceRoles: true })]),
    ).toBe("*");
  });

  it("returns nothing for a repository the reader was not granted", () => {
    const reader = user([{ role: ROLES.Reader, repoId: HG }]);
    expect(grantedSourceRoles(reader, RC, [map(ROLES.Reader, ["Facility Admin"])])).toEqual(
      [],
    );
  });

  it("agrees with the viewer for every role it lists", () => {
    // A display that drifts from the enforcement path is how a screen tells an
    // admin someone can read something the request then refuses.
    const reader = user([{ role: ROLES.Reader, repoId: HG }]);
    const mappings = [map(ROLES.Reader, ["Facility Admin", "Organization Admin"])];
    const viewer = viewerForRepo(reader, HG, mappings);

    const granted = grantedSourceRoles(reader, HG, mappings);
    expect(granted).not.toBe("*");
    for (const role of granted as string[]) {
      expect(viewer.canSee([role])).toBe(true);
    }
  });
});

describe("a grant with no repository", () => {
  // An account-wide grant is a grant that TRAVELS, and this file is the reason
  // that is rare: it satisfies a global check and belongs to no repository, so
  // it cannot pick up a repository's mapping. Without a mapping there is
  // nothing to grant, so it reads nothing — which is the safe direction.
  it("satisfies the capability globally but reads nothing in a repository", () => {
    const global = user([{ role: ROLES.Reader }]);
    const viewer = viewerForRepo(global, HG, [map(ROLES.Reader, ["Facility Admin"])]);

    expect(viewer.canSee(["Facility Admin"])).toBe(false);
    expect(viewer.canSee(undefined)).toBe(false);
  });
});
