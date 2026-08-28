/**
 * The portal's capability catalogue and its role → capability map.
 *
 * This is the "product data" `@stonedogcode/rbac` deliberately refuses to hold. The
 * package ships the evaluator; the names below are ours.
 *
 * Call sites ask `can(subject, "article:read", groupId)` — never for a role.
 * That is what survives a role being renamed or split, and it is what stops a
 * screen deciding what to show by comparing a role name as a string.
 */

import { ladderRoleMap, type RoleMap } from "@stonedogcode/rbac";

/**
 * Every permission the portal has. Listed exhaustively rather than typed as a
 * bare string, because within one application the catalogue *is* knowable and a
 * typo in a capability name is otherwise a silent denial.
 */
export const CAPABILITIES = [
  "article:read",
  "article:write",
  "repo:read",
  "repo:manage",
  /**
   * Editing which of a repository's own role names a portal role may read.
   *
   * Separate from `repo:manage` because it is the sharper knife. Managing a
   * repository decides whether its articles are here at all; managing its
   * mapping decides who sees which of them, and a mistake there is the one that
   * discloses rather than hides.
   */
  "mapping:manage",
  "member:invite",
  "member:manage",
  "account:manage",
  "sync:run",
] as const;

export type PortalCapability = (typeof CAPABILITIES)[number];

/**
 * The portal's roles, most privileged last.
 *
 * `SystemAdmin` is deliberately *not* an account role — it belongs to whoever
 * operates the deployment, not to a customer account, and it is the only role
 * that can run a sync or read across accounts.
 */
export const ROLES = {
  Guest: "Guest",
  Reader: "Reader",
  Writer: "Writer",
  AccountAdmin: "AccountAdmin",
  SystemAdmin: "SystemAdmin",
} as const;

export type PortalRole = (typeof ROLES)[keyof typeof ROLES];

/**
 * Guest → Reader → Writer → AccountAdmin genuinely *is* a ladder here: each
 * tier does everything the one below does and more. So `ladderRoleMap` is
 * honest for these four rather than a migration crutch.
 *
 * **Guest and Reader hold the same capability, and that is not a mistake.**
 * Both may read articles; what differs is *which* articles, and that is not a
 * capability question at all — it is decided by the role mapping on each
 * repository, where `Guest` is typically mapped to a narrower set of the
 * repository's own roles than `Reader` is. Expressing "sees less" as a
 * capability would put the distinction in the wrong place: capabilities answer
 * "may they do this kind of thing", mappings answer "to which content".
 *
 * `ladderRoleMap` is still the deprecated adapter, and that is worth being
 * uncomfortable about: the moment the portal grows a role that is *lateral* —
 * an auditor who may read everything but write nothing, a sync operator who may
 * do nothing else — this must become an explicit per-role capability set.
 * Adding such a role to the ladder would force it onto a scale it does not
 * belong on, which is precisely the failure `@stonedogcode/rbac` was built to
 * end. Guest is not lateral; it is genuinely the bottom rung. The next one may
 * not be.
 */
const ACCOUNT_LADDER = ladderRoleMap([
  {
    role: ROLES.Guest,
    capabilities: ["article:read"] satisfies PortalCapability[],
  },
  {
    role: ROLES.Reader,
    capabilities: ["repo:read"] satisfies PortalCapability[],
  },
  {
    role: ROLES.Writer,
    capabilities: ["article:write"] satisfies PortalCapability[],
  },
  {
    role: ROLES.AccountAdmin,
    capabilities: [
      "repo:manage",
      "mapping:manage",
      "member:invite",
      "member:manage",
      "account:manage",
    ] satisfies PortalCapability[],
  },
]);

/**
 * The full map, with SystemAdmin added as a **separate entry rather than a top
 * rung**.
 *
 * A rung would mean SystemAdmin inherits AccountAdmin's capabilities *in
 * whatever scope the assignment names*, which is not what it is. The operator
 * holds its capabilities **globally** — see `subjectForUser` — and expressing
 * that as "one step above account admin" is how a global role starts leaking
 * into per-account checks.
 */
export const ROLE_MAP: RoleMap = {
  ...ACCOUNT_LADDER,
  [ROLES.SystemAdmin]: [...CAPABILITIES],
};

/** Roles an account may assign to its own members. Excludes SystemAdmin. */
export const ASSIGNABLE_ACCOUNT_ROLES: PortalRole[] = [
  ROLES.Guest,
  ROLES.Reader,
  ROLES.Writer,
  ROLES.AccountAdmin,
];

/**
 * Roles held on the ACCOUNT rather than in one repository.
 *
 * A user's role column was, until this list existed, turned into no assignment
 * at all — so the first-admin rule produced an admin who could do nothing, and
 * `/admin/mapping` told them "there are no repositories you can configure".
 * Only an operator could administer anything.
 *
 * **The list is short on purpose, and the obvious wider version is wrong.**
 * Promoting *every* account role to account-wide would make `Reader` — which is
 * exactly what every non-first signup gets — satisfy `article:read` in every
 * repository, granted or not, which deletes the grant model. Guest, Reader and
 * Writer therefore stay per-repository: their role column is a default and a
 * label, and their access is what somebody granted them.
 *
 * `AccountAdmin` is here because its capabilities are account-shaped —
 * `member:manage`, `account:manage`, and a `mapping:manage` that has to work on
 * a repository before anybody has been granted it. `SystemAdmin` is here for
 * the same reason one rung up, and is deliberately not an *assignable* account
 * role.
 *
 * Being account-wide decides **whether** an administrator may act, never
 * **which articles** they read: that is still the role mapping's answer, and
 * `AccountAdmin` is a row on the mapping screen like any other. Absence still
 * denies — an admin whose mapping row grants nothing sees nothing.
 */
export const ACCOUNT_WIDE_ROLES: readonly PortalRole[] = [
  ROLES.AccountAdmin,
  ROLES.SystemAdmin,
];

/** Is this role held across the whole account rather than in one repository? */
export function isAccountWideRole(role: PortalRole): boolean {
  return ACCOUNT_WIDE_ROLES.includes(role);
}

/**
 * Roles that mean an account is being looked after by somebody.
 *
 * Read by `accountHasAdmin`, which decides whether the next person to sign up
 * is offered the admin role. Asking only about `AccountAdmin` was the narrower
 * reading and it handed accounts away: the README's bring-up promotes the first
 * admin to `SystemAdmin`, after which the account honestly had no *account*
 * admin, so the next stranger to guess the account id became its administrator.
 *
 * **Deliberately its own list, even though it currently matches
 * {@link ACCOUNT_WIDE_ROLES} exactly.** The two answer different questions and
 * are only coincidentally the same today: that one is about the *scope* a
 * role's capabilities are held at, this one is about *who counts as looking
 * after an account*. The first lateral role — the `capabilities.ts` warning
 * above imagines an auditor who may read everything and write nothing — would
 * plausibly be account-wide without being an administrator, and collapsing
 * these into one constant is how that role silently starts suppressing the
 * first-admin rule.
 */
export const ADMINISTRATOR_ROLES: readonly PortalRole[] = [
  ROLES.AccountAdmin,
  ROLES.SystemAdmin,
];

export function isAssignableAccountRole(value: unknown): value is PortalRole {
  return (
    typeof value === "string" &&
    (ASSIGNABLE_ACCOUNT_ROLES as string[]).includes(value)
  );
}
