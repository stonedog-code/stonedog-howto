import { isAssignableAccountRole, ROLES, type PortalRole } from "../capabilities";
import {
  portalRolesInRepo,
  readableRepoIds,
  subjectForUser,
  userCan,
  type PortalUser,
} from "../rbac";

// `isSystemAdmin` is kept as the parameter so every existing case below still
// says what it always said. It now selects an account ROLE rather than setting
// a flag -- the two express the same thing for these tests, and `accountRole`
// is what the subject is actually built from.
const user = (grants: PortalUser["grants"], isSystemAdmin = false): PortalUser => ({
  id: "u1",
  accountRole: isSystemAdmin ? "SystemAdmin" : "Reader",
  grants,
});

describe("repository-scoped roles", () => {
  it("lets a reader read their own repository and no other", () => {
    const reader = user([{ role: ROLES.Reader, repoId: "hopperguard" }]);

    expect(userCan(reader, "article:read", "hopperguard")).toBe(true);
    expect(userCan(reader, "article:read", "rozcards")).toBe(false);
  });

  it("does NOT let a repository-scoped role satisfy a global check", () => {
    // "May this person read articles anywhere" must not be yes because they can
    // read one repository.
    const reader = user([{ role: ROLES.Reader, repoId: "hopperguard" }]);
    expect(userCan(reader, "article:read")).toBe(false);
  });

  it("gives a writer their reader capabilities too", () => {
    const writer = user([{ role: ROLES.Writer, repoId: "hopperguard" }]);

    expect(userCan(writer, "article:read", "hopperguard")).toBe(true);
    expect(userCan(writer, "article:write", "hopperguard")).toBe(true);
    expect(userCan(writer, "repo:manage", "hopperguard")).toBe(false);
  });

  it("gives an account admin management of their repository and its mapping", () => {
    const admin = user([{ role: ROLES.AccountAdmin, repoId: "hopperguard" }]);

    expect(userCan(admin, "repo:manage", "hopperguard")).toBe(true);
    expect(userCan(admin, "mapping:manage", "hopperguard")).toBe(true);
    expect(userCan(admin, "member:invite", "hopperguard")).toBe(true);
    expect(userCan(admin, "article:read", "hopperguard")).toBe(true);
    // Still not a system capability.
    expect(userCan(admin, "sync:run", "hopperguard")).toBe(false);
  });

  it("lets one person hold different roles in different repositories", () => {
    // The thing a global role model cannot express, and the reason for all of
    // this: admin of one product's documentation, plain reader of another's.
    const mixed = user([
      { role: ROLES.AccountAdmin, repoId: "hopperguard" },
      { role: ROLES.Reader, repoId: "rozcards" },
    ]);

    expect(userCan(mixed, "repo:manage", "hopperguard")).toBe(true);
    expect(userCan(mixed, "repo:manage", "rozcards")).toBe(false);
    expect(userCan(mixed, "article:read", "rozcards")).toBe(true);
  });
});

describe("the Guest rung", () => {
  it("may read articles, and nothing else", () => {
    const guest = user([{ role: ROLES.Guest, repoId: "hopperguard" }]);

    expect(userCan(guest, "article:read", "hopperguard")).toBe(true);
    expect(userCan(guest, "repo:read", "hopperguard")).toBe(false);
    expect(userCan(guest, "article:write", "hopperguard")).toBe(false);
    expect(userCan(guest, "mapping:manage", "hopperguard")).toBe(false);
  });

  it("is still confined to the repository it was granted in", () => {
    const guest = user([{ role: ROLES.Guest, repoId: "hopperguard" }]);
    expect(userCan(guest, "article:read", "rozcards")).toBe(false);
    expect(userCan(guest, "article:read")).toBe(false);
  });

  // Guest and Reader hold the same reading capability on purpose. What a Guest
  // sees LESS of is decided by the repository's role mapping, not here —
  // capabilities answer "may they do this kind of thing", mappings answer "to
  // which content". Asserted so nobody later "fixes" the apparent redundancy by
  // taking article:read off Guest.
  it("reads articles exactly as a Reader does, by design", () => {
    const guest = user([{ role: ROLES.Guest, repoId: "hopperguard" }]);
    const reader = user([{ role: ROLES.Reader, repoId: "hopperguard" }]);

    expect(userCan(guest, "article:read", "hopperguard")).toBe(
      userCan(reader, "article:read", "hopperguard"),
    );
  });

  it("is beneath Reader on the ladder, which Reader inherits", () => {
    const reader = user([{ role: ROLES.Reader, repoId: "hopperguard" }]);
    expect(userCan(reader, "article:read", "hopperguard")).toBe(true);
    expect(userCan(reader, "repo:read", "hopperguard")).toBe(true);
  });
});

describe("the system admin", () => {
  const operator = user([], true);

  it("can read every repository, including ones that do not exist yet", () => {
    // Granted globally, so a repository added to articles.json tomorrow is
    // covered without anyone remembering to grant it.
    expect(userCan(operator, "article:read", "anything")).toBe(true);
    expect(userCan(operator, "article:read", "added-tomorrow")).toBe(true);
  });

  it("satisfies a global check, which no account role does", () => {
    expect(userCan(operator, "sync:run")).toBe(true);
    expect(userCan(operator, "account:manage")).toBe(true);
  });

  it("is not merely a top rung above account admin", () => {
    // A rung would inherit AccountAdmin's capabilities in whatever scope the
    // assignment named. The operator's are global; conflating the two is how a
    // global role leaks into per-account checks.
    const accountAdmin = user([{ role: ROLES.AccountAdmin, repoId: "hopperguard" }]);
    expect(userCan(accountAdmin, "sync:run", "hopperguard")).toBe(false);
    expect(userCan(accountAdmin, "article:read", "rozcards")).toBe(false);
  });
});

describe("a user with no grants", () => {
  it("can do nothing at all, without throwing", () => {
    const nobody = user([]);
    expect(userCan(nobody, "article:read", "hopperguard")).toBe(false);
    expect(userCan(nobody, "article:read")).toBe(false);
    expect(subjectForUser(nobody).grants).toEqual([]);
  });
});

describe("readableRepoIds", () => {
  const all = ["hopperguard", "rozcards", "optima"];

  it("returns only the repositories the user may read", () => {
    const reader = user([
      { role: ROLES.Reader, repoId: "hopperguard" },
      { role: ROLES.Writer, repoId: "optima" },
    ]);
    expect(readableRepoIds(reader, all)).toEqual(["hopperguard", "optima"]);
  });

  it("returns everything for the operator", () => {
    expect(readableRepoIds(user([], true), all)).toEqual(all);
  });

  it("returns nothing for a stranger", () => {
    expect(readableRepoIds(user([]), all)).toEqual([]);
  });

  it("agrees with userCan for every repository", () => {
    // A convenience that drifts from the enforcement path is how a page ends up
    // listing a repository whose articles the request then refuses.
    const mixed = user([{ role: ROLES.Reader, repoId: "rozcards" }]);
    const readable = new Set(readableRepoIds(mixed, all));
    for (const repoId of all) {
      expect(readable.has(repoId)).toBe(userCan(mixed, "article:read", repoId));
    }
  });
});

describe("portalRolesInRepo", () => {
  it("returns the roles held in that repository alone", () => {
    const mixed = user([
      { role: ROLES.Reader, repoId: "hopperguard" },
      { role: ROLES.Guest, repoId: "hopperguard" },
      { role: ROLES.AccountAdmin, repoId: "rozcards" },
    ]);

    expect(portalRolesInRepo(mixed, "hopperguard").sort()).toEqual(["Guest", "Reader"]);
    expect(portalRolesInRepo(mixed, "rozcards")).toEqual(["AccountAdmin"]);
    expect(portalRolesInRepo(mixed, "optima")).toEqual([]);
  });

  // The operator's reach is a capability granted globally, not a portal role
  // assigned in a repository. Folding it in here would make every mapping
  // lookup quietly true for them, which is a different claim from "may read" —
  // and it would hide the operator's reach inside a data structure the mapping
  // screen renders as if an admin had configured it.
  it("does not invent a role for the system admin", () => {
    expect(portalRolesInRepo(user([], true), "hopperguard")).toEqual([]);
  });

  it("ignores an account-wide grant, which belongs to no repository", () => {
    const global = user([{ role: ROLES.Reader }]);
    expect(portalRolesInRepo(global, "hopperguard")).toEqual([]);
  });
});

describe("an account-wide grant", () => {
  // Granted with no scope, so it satisfies a GLOBAL check — unlike every
  // repository-scoped grant, which satisfies a check in its repository and
  // nowhere else. A grant that travels is a bug unless it was written to
  // travel, so this shape exists and is deliberately rare.
  it("satisfies a global check, and every repository check with it", () => {
    const global = user([{ role: ROLES.Reader }]);

    expect(userCan(global, "article:read")).toBe(true);
    expect(userCan(global, "article:read", "hopperguard")).toBe(true);
    expect(userCan(global, "article:read", "any-repo-at-all")).toBe(true);
  });

  it("still grants only what its role holds", () => {
    const global = user([{ role: ROLES.Reader }]);
    expect(userCan(global, "article:write")).toBe(false);
    expect(userCan(global, "sync:run")).toBe(false);
  });
});

describe("isAssignableAccountRole", () => {
  it("accepts the account roles and refuses SystemAdmin", () => {
    // SystemAdmin is excluded on purpose: it is the deployment operator, not
    // something an account may hand out to its own members.
    expect(isAssignableAccountRole(ROLES.Guest)).toBe(true);
    expect(isAssignableAccountRole(ROLES.AccountAdmin)).toBe(true);
    expect(isAssignableAccountRole(ROLES.SystemAdmin)).toBe(false);
  });

  it("refuses anything that is not a role name, without throwing", () => {
    // It guards a boundary — a role arriving from a form or an API — so a
    // number or an object must be refused rather than crash the request.
    expect(isAssignableAccountRole("Sysadmin")).toBe(false);
    expect(isAssignableAccountRole(undefined)).toBe(false);
    expect(isAssignableAccountRole(42)).toBe(false);
    expect(isAssignableAccountRole({ role: "Reader" })).toBe(false);
  });
});

/**
 * The account role, and the reason it is not simply "whatever the column says".
 *
 * Until this existed the column produced no assignment at all, so the
 * first-admin rule — arbitrated by a partial unique index, with an integration
 * test racing eight concurrent signups to prove exactly one wins — appointed an
 * administrator who could do nothing. `/admin/mapping` told them there were no
 * repositories they could configure, and only the deployment operator could
 * administer anything.
 */
describe("the role held on the account", () => {
  const withRole = (accountRole: PortalRole, grants: PortalUser["grants"] = []): PortalUser => ({
    id: "u1",
    accountRole,
    grants,
  });

  it("lets an account admin administer a repository they were never granted", () => {
    // The whole point. A mapping has to be editable BEFORE anybody has been
    // granted the repository, or no repository can ever be adopted.
    const admin = withRole(ROLES.AccountAdmin);

    expect(userCan(admin, "mapping:manage", "hopperguard")).toBe(true);
    expect(userCan(admin, "member:manage")).toBe(true);
    expect(userCan(admin, "article:read", "any-repo-at-all")).toBe(true);
  });

  it("does NOT let a reader read a repository nobody granted them", () => {
    // The test that stops the tempting wider fix. Promoting *every* account
    // role to account-wide is one line shorter and deletes the grant model:
    // `Reader` is exactly what every non-first signup gets, so it would make
    // every member a reader of every repository in the account.
    const reader = withRole(ROLES.Reader);

    expect(userCan(reader, "article:read", "hopperguard")).toBe(false);
    expect(userCan(reader, "repo:read", "hopperguard")).toBe(false);
  });

  it("gives a guest and a writer nothing account-wide either", () => {
    expect(userCan(withRole(ROLES.Guest), "article:read", "hopperguard")).toBe(false);
    expect(userCan(withRole(ROLES.Writer), "article:write", "hopperguard")).toBe(false);
  });

  it("still honours a per-repository grant held by a reader", () => {
    // Their access is what somebody granted them, and it does not travel.
    const reader = withRole(ROLES.Reader, [{ role: ROLES.Reader, repoId: "hopperguard" }]);

    expect(userCan(reader, "article:read", "hopperguard")).toBe(true);
    expect(userCan(reader, "article:read", "rozcards")).toBe(false);
  });

  it("keeps an account admin's reach inside capabilities, not above them", () => {
    // AccountAdmin is not a rung below SystemAdmin: running a sync is the
    // operator's, and an account administrator must not acquire it by being
    // account-wide.
    expect(userCan(withRole(ROLES.AccountAdmin), "sync:run")).toBe(false);
    expect(userCan(withRole(ROLES.SystemAdmin), "sync:run")).toBe(true);
  });

  it("puts an account admin's role into every repository, so the mapping decides", () => {
    // `userCan` saying yes while `portalRolesInRepo` said nothing is the split
    // that would show an administrator a repository's name and none of its
    // articles — the capability check and the viewer disagreeing.
    expect(portalRolesInRepo(withRole(ROLES.AccountAdmin), "hopperguard")).toEqual([
      ROLES.AccountAdmin,
    ]);
    expect(portalRolesInRepo(withRole(ROLES.Reader), "hopperguard")).toEqual([]);
  });

  it("keeps a system admin out of the mapping, so a mapping mistake still shows", () => {
    // Their reach is answered by the viewer's own short-circuit. Folding it in
    // here would make every mapping lookup quietly true for the one person most
    // likely to be checking whether a mapping is right.
    expect(portalRolesInRepo(withRole(ROLES.SystemAdmin), "hopperguard")).toEqual([]);
  });
});
