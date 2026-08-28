/**
 * Turning a signed-in user into a `@stonedogcode/rbac` subject.
 *
 * This is the seam where the shared packages meet, and it is the only file in
 * the portal that knows how they fit together.
 */

import { can, subjectFromRoles, type Subject } from "@stonedogcode/rbac";

import {
  ROLES,
  ROLE_MAP,
  isAccountWideRole,
  type PortalCapability,
  type PortalRole,
} from "./capabilities";

/**
 * A synced repository is the scope.
 *
 * ## Why the repository, and not a group
 *
 * The first design made a flat *group* the scope, and said a synced article's
 * own `roles` grant nothing at all — the group governed, and the article's list
 * was kept only as provenance. The instinct behind that was right and aimed at
 * the wrong target, so it is worth writing down what changed rather than
 * quietly reversing it.
 *
 * The danger identified then was real: an article's `roles` are the names its
 * *source application* wrote, and a role name that matches nothing **restricts
 * nothing**. Interpreting four applications' vocabularies in one namespace
 * means `Admin` in one silently means `Admin` in another, and the failure is
 * asymmetric — getting it wrong makes an admin-only article readable, with
 * nothing failing.
 *
 * But that is an argument against mapping those names **implicitly**, not
 * against mapping them. An explicit, portal-managed mapping keeps the safety
 * property as its defining rule — **absence denies** — and inverts the failure
 * mode: a mistake now *hides* articles, which the reader who cannot find one
 * complains about, rather than revealing them, which nobody complains about.
 *
 * So a repository is the scope, a grant is per repository, and which of that
 * repository's own role names a portal role may read is decided by a mapping
 * an account admin maintains. Groups are gone; they were a bundling layer over
 * exactly this, and a person picks a repository.
 */
export type RepoId = string;

export interface PortalGrant {
  role: PortalRole;
  /**
   * The repository this role applies in. Absent for an account-wide role —
   * which is a grant that travels, and should be rare.
   */
  repoId?: RepoId;
}

export interface PortalUser {
  id: string;
  /**
   * The role held on the ACCOUNT, independent of any repository.
   *
   * Was `isSystemAdmin: boolean`, which threw away everything the column said
   * except one value — and that is precisely how an `AccountAdmin` came to hold
   * no capabilities anywhere. Carrying the role itself means the account-wide
   * question is asked of the data rather than of a flag somebody has to
   * remember to widen.
   */
  accountRole: PortalRole;
  grants: readonly PortalGrant[];
}

/**
 * The deployment's operator, not a customer's admin.
 *
 * A function rather than a field so it cannot drift from `accountRole`: two
 * pieces of state that must agree are one bug waiting for somebody to set one
 * of them.
 */
export function isSystemAdmin(user: PortalUser): boolean {
  return user.accountRole === ROLES.SystemAdmin;
}

/**
 * Build the subject `can` evaluates.
 *
 * A system admin's capabilities are granted **globally** — with no scope — so
 * they satisfy a check in any repository and also a global check. Every other
 * role is granted only in the repository it was assigned in, so it satisfies a
 * check there and nowhere else, including the global scope.
 *
 * That asymmetry is the whole point. A grant that travels is a bug unless it
 * was written to travel.
 */
export function subjectForUser(user: PortalUser): Subject {
  const assignments = user.grants.map((grant) =>
    grant.repoId === undefined
      ? { role: grant.role }
      : { role: grant.role, scope: grant.repoId },
  );

  // The account role, when it is one that is held account-wide.
  //
  // This line is the whole of the fix for an administrator who could do
  // nothing: the column was read only to set a boolean, so `AccountAdmin`
  // produced no assignment and `can(subject, "mapping:manage", repoId)` was
  // false for the very person the first-admin rule had just appointed.
  //
  // Guarded by ACCOUNT_WIDE_ROLES rather than pushed unconditionally, because
  // unconditional is the version that breaks the model — see that list.
  if (isAccountWideRole(user.accountRole)) assignments.push({ role: user.accountRole });

  // `onUnknownRole` left at its default of "ignore": a role row that outlives
  // the code knowing about it must not crash somebody's sign-in. Drift is
  // caught at boot instead.
  return subjectFromRoles(assignments, ROLE_MAP);
}

/** The portal's own `can`, with the capability type narrowed. */
export function userCan(
  user: PortalUser,
  capability: PortalCapability,
  repoId?: RepoId,
): boolean {
  return can(subjectForUser(user), capability, repoId);
}

/**
 * Every repository this user may read, computed once.
 *
 * Filtering happens against this on the server. A page that asked per-article
 * would ask the same question a hundred times and get it right ninety-nine.
 */
export function readableRepoIds(
  user: PortalUser,
  allRepoIds: readonly RepoId[],
): RepoId[] {
  return allRepoIds.filter((repoId) => userCan(user, "article:read", repoId));
}

/**
 * The portal roles this user holds in one repository.
 *
 * This is what the role mapping is keyed on, so it is the input to the viewer
 * that will replace `viewerForGroup`. A system admin deliberately does **not**
 * appear here: an operator's reach is a capability granted globally, not a
 * portal role assigned in a repository, and folding it in would make every
 * mapping lookup quietly true for them.
 */
export function portalRolesInRepo(user: PortalUser, repoId: RepoId): PortalRole[] {
  const granted = user.grants
    .filter((grant) => grant.repoId === repoId)
    .map((grant) => grant.role);

  // An account administrator holds their role in every repository of their
  // account, so it belongs here too — and it has to, or the two halves of the
  // decision disagree: `userCan(admin, "article:read", repoId)` would be true
  // while this returned nothing, the viewer would fall through to SEES_NOTHING,
  // and an administrator would be told a repository exists and shown none of
  // it. That kind of split between the capability check and the viewer is the
  // composition failure the E2E tier exists to catch.
  //
  // It reaches the mapping like any other role rather than bypassing it, which
  // is the point: being an administrator decides THAT they may read this
  // repository, and the `AccountAdmin` row on the mapping screen still decides
  // WHICH of its articles. Absence still denies — an admin whose mapping row
  // grants nothing sees nothing, and that is a legible state rather than a bug.
  //
  // SystemAdmin is still excluded, deliberately: an operator's reach is a
  // capability granted globally, and folding it in would make every mapping
  // lookup quietly true for them and hide a real mapping mistake.
  if (user.accountRole === ROLES.AccountAdmin) granted.push(ROLES.AccountAdmin);

  return granted;
}
