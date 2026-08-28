import { createPasswordFactor, type PasswordFactor } from "@stonedogcode/auth";
import type { Argon2Binding } from "@stonedogcode/auth";

import { ROLES } from "../capabilities";
import { signup, type SignupStore } from "../signup";

const fakeArgon2: Argon2Binding = {
  hash: async (plain) =>
    `$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$${Buffer.from(plain).toString("base64url")}`,
  verify: async (digest, plain) =>
    digest.split("$").pop() === Buffer.from(plain).toString("base64url"),
};

const passwords: PasswordFactor = createPasswordFactor({ argon2: fakeArgon2 });

/**
 * A store that arbitrates the admin slot ATOMICALLY, as the contract requires —
 * one map operation, no read-then-write.
 *
 * Modelled correctly on purpose: a fake that counted first and then inserted
 * would let the concurrency test pass against a store that races in Postgres,
 * which is the exact bug the contract exists to prevent.
 */
function fakeStore(): SignupStore & { admins: Map<string, string>; users: string[] } {
  const admins = new Map<string, string>();
  const users: string[] = [];
  let nextId = 1;

  return {
    admins,
    users,
    async accountHasAdmin(accountId) {
      return admins.has(accountId);
    },
    async createUser({ accountId, email, desiredRole }) {
      if (users.includes(email)) throw new Error("duplicate email");
      const id = `u${nextId++}`;
      users.push(email);

      // The atomic bit: claiming the slot and losing are one operation.
      if (desiredRole === ROLES.AccountAdmin && !admins.has(accountId)) {
        admins.set(accountId, id);
        return { id, role: ROLES.AccountAdmin };
      }
      return { id, role: ROLES.Reader };
    },
  };
}

describe("the first user of an account", () => {
  it("becomes the account admin", () => {
    const store = fakeStore();
    return signup(
      { accountId: "acct-1", email: "first@example.com", password: "correct horse battery" },
      { store, passwords },
    ).then((result) => {
      expect(result.ok && result.user.role).toBe(ROLES.AccountAdmin);
      expect(result.ok && result.user.isFirstAdmin).toBe(true);
    });
  });

  it("and everybody after them joins as a reader", async () => {
    const store = fakeStore();
    await signup(
      { accountId: "acct-1", email: "first@example.com", password: "correct horse battery" },
      { store, passwords },
    );
    const second = await signup(
      { accountId: "acct-1", email: "second@example.com", password: "correct horse battery" },
      { store, passwords },
    );

    expect(second.ok && second.user.role).toBe(ROLES.Reader);
    expect(second.ok && second.user.isFirstAdmin).toBe(false);
  });

  it("gives EXACTLY ONE admin when two people sign up simultaneously", async () => {
    // The race this whole module is shaped around. A double-clicked button on a
    // slow connection is enough: `if (count === 0) role = Admin` has both
    // requests read zero and both become admin.
    const store = fakeStore();
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        signup(
          { accountId: "acct-1", email: `p${i}@example.com`, password: "correct horse battery" },
          { store, passwords },
        ),
      ),
    );

    const admins = results.filter((r) => r.ok && r.user.role === ROLES.AccountAdmin);
    expect(admins).toHaveLength(1);
    expect(store.admins.size).toBe(1);
  });

  it("is per account, so a second account gets its own admin", () => {
    const store = fakeStore();
    return signup(
      { accountId: "acct-1", email: "a@example.com", password: "correct horse battery" },
      { store, passwords },
    )
      .then(() =>
        signup(
          { accountId: "acct-2", email: "b@example.com", password: "correct horse battery" },
          { store, passwords },
        ),
      )
      .then((result) => {
        expect(result.ok && result.user.role).toBe(ROLES.AccountAdmin);
      });
  });

  it("reports the role the STORE assigned, never the one requested", async () => {
    // If the two may diverge silently, "first user is admin" quietly becomes
    // "whoever asked nicely is admin".
    const store = fakeStore();
    // Force the hint to be wrong: `accountHasAdmin` is consulted before the
    // insert, and the slot can be taken in between.
    store.admins.set("acct-1", "someone-else");
    const result = await signup(
      { accountId: "acct-1", email: "late@example.com", password: "correct horse battery" },
      { store, passwords },
    );

    expect(result.ok && result.user.role).toBe(ROLES.Reader);
  });
});

describe("failures a stranger can trigger", () => {
  it("reports a duplicate email with the SAME reason as anything else", async () => {
    // "That email is already registered" is an account enumerator with a form
    // in front of it. The caller emails the existing owner instead — they find
    // out, a stranger does not.
    const store = fakeStore();
    await signup(
      { accountId: "acct-1", email: "taken@example.com", password: "correct horse battery" },
      { store, passwords },
    );
    const again = await signup(
      { accountId: "acct-2", email: "taken@example.com", password: "correct horse battery" },
      { store, passwords },
    );

    expect(again).toEqual({ ok: false, reason: "rejected" });
  });

  it("reports a weak password separately, because the user chose it", async () => {
    const store = fakeStore();
    const result = await signup(
      { accountId: "acct-1", email: "a@example.com", password: "short" },
      { store, passwords },
    );

    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe("weak-password");
  });

  // The `error instanceof Error` false branch. It looks like defensive noise
  // until you ask what it defends: this path builds a message that is shown to
  // the person signing up, from whatever the password factor threw. A binding
  // that rejects with a string, or with an object carrying the attempted
  // password, is not an Error -- and interpolating it would put that value on
  // the screen. The fallback is what makes the pass-through safe, so it is
  // worth a test rather than a coverage waiver.
  it("falls back to a fixed message when the factor throws a non-Error", async () => {
    const throwsAString: PasswordFactor = {
      ...passwords,
      hash: async () => {
        throw "hunter2 is too weak";
      },
    };

    const result = await signup(
      { accountId: "acct-1", email: "a@example.com", password: "hunter2" },
      { store: fakeStore(), passwords: throwsAString },
    );

    expect(!result.ok && result.reason).toBe("weak-password");
    expect(!result.ok && "message" in result && result.message).toBe(
      "That password is not acceptable.",
    );
    // The thrown value never reaches the reader, password and all.
    expect(!result.ok && "message" in result && result.message).not.toContain("hunter2");
  });

  it("never puts the password in the weak-password message", async () => {
    const store = fakeStore();
    const result = await signup(
      { accountId: "acct-1", email: "a@example.com", password: "hunter2" },
      { store, passwords },
    );

    expect(!result.ok && "message" in result && result.message).not.toContain("hunter2");
  });

  it("does not create a user when the password is refused", async () => {
    const store = fakeStore();
    await signup(
      { accountId: "acct-1", email: "a@example.com", password: "short" },
      { store, passwords },
    );

    expect(store.users).toEqual([]);
    expect(store.admins.size).toBe(0);
  });
});
