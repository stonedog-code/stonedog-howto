/**
 * Signup, and the rule that the first person to join an account runs it.
 *
 * The interesting part is not the password — `@stonedogcode/auth` owns that —
 * but the **race**. "First user becomes the admin" read as
 * `if ((await countUsers()) === 0) role = AccountAdmin` is a check-then-act,
 * and two simultaneous signups both read zero and both become admin. That is
 * not a theoretical race: it is the normal outcome of a double-clicked button
 * on a slow connection.
 */

import type { PasswordFactor } from "@stonedogcode/auth";

import { ROLES, type PortalRole } from "./capabilities";

export interface SignupInput {
  accountId: string;
  email: string;
  password: string;
}

export interface CreatedUser {
  id: string;
  role: PortalRole;
  /** True when this user became the account's first admin. */
  isFirstAdmin: boolean;
}

/**
 * What signup needs from storage.
 *
 * `createFirstAdminAtomically` carries the whole rule, and its contract is
 * strict on purpose — see the note at the top of this file.
 */
export interface SignupStore {
  /**
   * Insert the user **and** claim the account's admin slot in ONE atomic
   * operation, returning whether this call won the slot.
   *
   * The intended implementation is a conditional insert or a unique constraint:
   * a partial unique index on `(accountId)` where `role = 'AccountAdmin'` lets
   * the database arbitrate, and the loser is told it lost rather than silently
   * becoming a second admin.
   *
   * **A read-then-write implementation satisfies these types and is wrong.**
   * If your store cannot express the constraint, take the row lock; do not
   * count first and then insert.
   */
  createUser(input: {
    accountId: string;
    email: string;
    passwordHash: string;
    /** The role to attempt. The store may downgrade it — see the return. */
    desiredRole: PortalRole;
  }): Promise<{ id: string; role: PortalRole }>;

  /**
   * True when this account **already has an admin**.
   *
   * Deliberately not "does the account exist". The two coincide only if an
   * account row is created by the same call that creates its first user, and
   * it is not: an account is created first and people sign up to it. Under the
   * existence test the hint below is always "not new", nobody ever asks for
   * the admin role, the partial unique index never gets a row to arbitrate,
   * and the account ends up with NO admin at all — silently, because nothing
   * failed.
   *
   * Still only a hint. Two callers may both read `false` and both ask for
   * admin; the store arbitrates and the loser is downgraded. That is the whole
   * design, and it is why a racy read here is harmless.
   */
  accountHasAdmin(accountId: string): Promise<boolean>;
}

export type SignupResult =
  | { ok: true; user: CreatedUser }
  /**
   * One reason for every failure a stranger can trigger.
   *
   * "That email is already registered" is an account enumerator with a form in
   * front of it: it answers "does this person have an account here" for anyone
   * who asks. The caller sends the same response either way and emails the
   * existing owner instead — they find out, and a stranger does not.
   */
  | { ok: false; reason: "rejected" }
  /** The password failed the policy. Safe to show: the user chose it. */
  | { ok: false; reason: "weak-password"; message: string };

export interface SignupOptions {
  store: SignupStore;
  passwords: PasswordFactor;
}

/**
 * Register a user.
 *
 * The **first** user of an account becomes its `AccountAdmin`; everyone after
 * joins as a `Reader`. Which one happened is decided by the store, atomically,
 * and reported back — this function never asks "how many users are there".
 */
export async function signup(
  input: SignupInput,
  { store, passwords }: SignupOptions,
): Promise<SignupResult> {
  let passwordHash: string;
  try {
    passwordHash = await passwords.hash(input.password);
  } catch (error) {
    // WeakSecretError's message never contains the password — that is asserted
    // in @stonedogcode/auth's own tests — so it is safe to pass through.
    return {
      ok: false,
      reason: "weak-password",
      message: error instanceof Error ? error.message : "That password is not acceptable.",
    };
  }

  const accountHasNoAdmin = !(await store.accountHasAdmin(input.accountId));

  let created: { id: string; role: PortalRole };
  try {
    created = await store.createUser({
      accountId: input.accountId,
      email: input.email,
      passwordHash,
      // Ask for admin whenever the account appears to have none. The store is
      // what decides — this is a hint, not the rule, precisely because the
      // answer can change between this line and the insert.
      desiredRole: accountHasNoAdmin ? ROLES.AccountAdmin : ROLES.Reader,
    });
  } catch {
    // A duplicate email, a lost admin race resolved as a constraint violation,
    // or anything else. All indistinguishable to the caller.
    return { ok: false, reason: "rejected" };
  }

  return {
    ok: true,
    user: {
      id: created.id,
      // The role the store actually assigned, never the one requested. If the
      // two are allowed to diverge silently, "first user is admin" becomes
      // "whoever asked nicely is admin".
      role: created.role,
      isFirstAdmin: created.role === ROLES.AccountAdmin,
    },
  };
}
