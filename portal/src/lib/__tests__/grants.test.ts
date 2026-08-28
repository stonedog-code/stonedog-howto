import { ROLES, type PortalRole } from "../capabilities";
import { grantChanges, readRequestedGrants, type GrantRow } from "../grants";

const HG = "hopperguard";
const RC = "rozcards";
const OTHER = "another-accounts-repo";

const ACCOUNT_REPOS = new Set([HG, RC]);

const g = (repoId: string, role: PortalRole = ROLES.Reader): GrantRow => ({ repoId, role });

describe("readRequestedGrants", () => {
  it("keeps what the account may express", () => {
    const { grants, rejected } = readRequestedGrants(
      [g(HG, ROLES.Reader), g(RC, ROLES.Guest)],
      ACCOUNT_REPOS,
    );

    expect(grants).toEqual([g(HG, ROLES.Reader), g(RC, ROLES.Guest)]);
    expect(rejected).toEqual([]);
  });

  it("refuses SystemAdmin, which is the operator's and not an account's to give", () => {
    const { grants, rejected } = readRequestedGrants(
      [g(HG, ROLES.SystemAdmin), g(HG, ROLES.Reader)],
      ACCOUNT_REPOS,
    );

    // A form never offers it; a crafted POST can, and that is the case this is
    // written for. Escalating to the deployment operator must not be one field.
    expect(grants).toEqual([g(HG, ROLES.Reader)]);
    expect(rejected).toEqual([g(HG, ROLES.SystemAdmin)]);
  });

  it("refuses a repository this account does not hold", () => {
    // The repository id arrives from a request. Without this, an admin of one
    // account could grant their own members a repository belonging to another.
    const { grants, rejected } = readRequestedGrants([g(OTHER)], ACCOUNT_REPOS);

    expect(grants).toEqual([]);
    expect(rejected).toEqual([g(OTHER)]);
  });

  it("reports what it rejected rather than dropping it quietly", () => {
    // A save that silently ignored half its input looks exactly like one that
    // worked, which is the failure this whole portal keeps finding.
    const { rejected } = readRequestedGrants([g(OTHER), g(HG, ROLES.SystemAdmin)], ACCOUNT_REPOS);
    expect(rejected).toHaveLength(2);
  });

  it("collapses a duplicate rather than letting the insert fail", () => {
    const { grants } = readRequestedGrants([g(HG), g(HG)], ACCOUNT_REPOS);
    expect(grants).toEqual([g(HG)]);
  });

  it("treats a role and a repository as a pair, not as two independent lists", () => {
    // Reader on Hopperguard and Guest on RozCards must not become four grants.
    const { grants } = readRequestedGrants(
      [g(HG, ROLES.Reader), g(RC, ROLES.Guest)],
      ACCOUNT_REPOS,
    );
    expect(grants).toHaveLength(2);
    expect(grants).not.toContainEqual(g(HG, ROLES.Guest));
  });
});

describe("grantChanges", () => {
  const offered = ACCOUNT_REPOS;

  it("adds what is new and removes what was unticked", () => {
    const changes = grantChanges([g(HG, ROLES.Reader)], [g(RC, ROLES.Guest)], offered);

    expect(changes.add).toEqual([g(RC, ROLES.Guest)]);
    expect(changes.remove).toEqual([g(HG, ROLES.Reader)]);
  });

  it("writes nothing when nothing changed", () => {
    // What makes the screen safe to press twice, and keeps an unchanged save
    // out of the audit trail entirely.
    const held = [g(HG, ROLES.Reader), g(RC, ROLES.Guest)];
    expect(grantChanges(held, held, offered)).toEqual({ add: [], remove: [] });
  });

  it("keeps a second role in the same repository", () => {
    // The schema is unique on (user, repo, role), so holding two roles in one
    // repository is a real state and the mapping merges both.
    const changes = grantChanges(
      [g(HG, ROLES.Reader)],
      [g(HG, ROLES.Reader), g(HG, ROLES.Writer)],
      offered,
    );

    expect(changes.add).toEqual([g(HG, ROLES.Writer)]);
    expect(changes.remove).toEqual([]);
  });

  it("never removes a grant in a repository the form did not offer", () => {
    // The load-bearing case. A repository this admin could not see — or one
    // added between the page rendering and Save being pressed — must survive,
    // or one person's save silently revokes another's work.
    const changes = grantChanges([g(OTHER, ROLES.Reader)], [], offered);

    expect(changes.remove).toEqual([]);
    expect(changes.add).toEqual([]);
  });

  it("removes every role when a person is unticked entirely", () => {
    const changes = grantChanges([g(HG, ROLES.Reader), g(HG, ROLES.Writer)], [], offered);
    expect(changes.remove).toHaveLength(2);
  });
});
