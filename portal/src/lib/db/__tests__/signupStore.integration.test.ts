/**
 * Integration tier: signup against real PostgreSQL.
 *
 * The unit tests run against a fake store that models the admin-slot constraint
 * correctly — which is precisely why they prove nothing about it. A fake that
 * behaves correctly agrees with a schema that has no constraint at all, and the
 * failure that would follow is not a crash: it is two account admins, silently,
 * on a double-clicked button.
 *
 * So this file asks the database. Needs `docker compose up -d` and
 * `npx prisma migrate deploy`; it is excluded from the default `test` run and
 * has its own script, because a suite that cannot run without a daemon is a
 * suite people start skipping.
 */

import { PrismaClient } from "@prisma/client";

import { ROLES } from "../../capabilities";
import { signup } from "../../signup";
import { prismaSignupStore } from "../signupStore";

const prisma = new PrismaClient();
const store = prismaSignupStore(prisma);

// Real hashing is slow by design (argon2), and eight concurrent signups would
// spend seconds on it while proving nothing about the race. The race is in the
// INSERT, so the password factor is stubbed to keep the test about that.
const passwords = {
  hash: async (password: string) => `hashed:${password}`,
  verify: async () => true,
} as unknown as Parameters<typeof signup>[1]["passwords"];

let accountSeq = 0;
const freshAccount = async (): Promise<string> => {
  const id = `acct-${process.pid}-${accountSeq++}`;
  await prisma.account.create({ data: { id, name: id } });
  return id;
};

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { accountId: { startsWith: `acct-${process.pid}-` } } });
  await prisma.account.deleteMany({ where: { id: { startsWith: `acct-${process.pid}-` } } });
  await prisma.$disconnect();
});

describe("the first user of an account", () => {
  it("becomes its admin", async () => {
    const accountId = await freshAccount();
    const result = await signup(
      { accountId, email: "first@example.com", password: "a-long-enough-password" },
      { store, passwords },
    );

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.user.role).toBe(ROLES.AccountAdmin);
    expect(result.user.isFirstAdmin).toBe(true);
  });

  it("leaves everyone after as a Reader", async () => {
    const accountId = await freshAccount();
    await signup(
      { accountId, email: "first@example.com", password: "a-long-enough-password" },
      { store, passwords },
    );
    const second = await signup(
      { accountId, email: "second@example.com", password: "a-long-enough-password" },
      { store, passwords },
    );

    expect(second).toMatchObject({ ok: true });
    if (!second.ok) return;
    expect(second.user.role).toBe(ROLES.Reader);
    expect(second.user.isFirstAdmin).toBe(false);
  });

  /**
   * The account-takeover case, and the reason it belongs in THIS tier.
   *
   * The unit tier's fake answers `accountHasAdmin` from whatever set the test
   * put in it, so it agrees with any definition of "admin" the code chooses —
   * including the wrong one. Only a real query against a real row can tell them
   * apart, which is the whole argument for this file existing.
   *
   * What it guards: the README's bring-up promotes the first admin to
   * `SystemAdmin`, because that role is assigned out of band. The old query
   * asked for `AccountAdmin` alone, so the account then had no admin by its own
   * definition and the next signup was offered the role. Signup needs an
   * account id and a password of the signer's choosing and nothing else.
   */
  it("does not offer the admin role to the next signup when a SystemAdmin holds the account", async () => {
    const accountId = await freshAccount();

    const first = await signup(
      { accountId, email: "operator@example.com", password: "a-long-enough-password" },
      { store, passwords },
    );
    expect(first).toMatchObject({ ok: true });

    // Exactly the out-of-band promotion the README documents.
    await prisma.user.updateMany({
      where: { accountId },
      data: { role: ROLES.SystemAdmin },
    });

    const stranger = await signup(
      { accountId, email: "stranger@example.com", password: "a-long-enough-password" },
      { store, passwords },
    );

    expect(stranger).toMatchObject({ ok: true });
    if (!stranger.ok) return;
    expect(stranger.user.role).toBe(ROLES.Reader);
    expect(stranger.user.isFirstAdmin).toBe(false);
  });

  it("still makes the first user an admin when the account holds nobody at all", async () => {
    // The other direction, so the fix cannot be "always answer yes" — which
    // would pass the test above and leave every account with no admin and
    // nothing failing to say so, which is the failure `accountHasAdmin`'s own
    // comment was written about.
    const accountId = await freshAccount();
    const result = await signup(
      { accountId, email: "only@example.com", password: "a-long-enough-password" },
      { store, passwords },
    );

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.user.role).toBe(ROLES.AccountAdmin);
  });
});

describe("the race the fake cannot prove", () => {
  // The reason this file exists. `if (userCount === 0)` passes every unit test
  // and fails here.
  it("yields exactly one admin from eight simultaneous signups", async () => {
    const accountId = await freshAccount();

    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        signup(
          { accountId, email: `racer${i}@example.com`, password: "a-long-enough-password" },
          { store, passwords },
        ),
      ),
    );

    // Every one of them gets an account. Losing a race you did not know you
    // were in must not cost you your signup.
    expect(results.every((r) => r.ok)).toBe(true);

    const admins = results.filter((r) => r.ok && r.user.role === ROLES.AccountAdmin);
    expect(admins).toHaveLength(1);

    // And the database agrees with what the callers were told — a store that
    // reported one admin while storing two would satisfy the line above.
    const stored = await prisma.user.count({
      where: { accountId, role: ROLES.AccountAdmin },
    });
    expect(stored).toBe(1);

    expect(await prisma.user.count({ where: { accountId } })).toBe(8);
  });

  it("reports the role it ASSIGNED, never the one it asked for", async () => {
    // `signup` asks for AccountAdmin whenever the account looks new. Under
    // concurrency that hint is wrong for seven of eight callers, and the store
    // downgrades them. A store that echoed the request back would turn "first
    // user is admin" into "whoever asked is admin".
    const accountId = await freshAccount();

    const results = await Promise.all(
      Array.from({ length: 4 }, (_, i) =>
        signup(
          { accountId, email: `hint${i}@example.com`, password: "a-long-enough-password" },
          { store, passwords },
        ),
      ),
    );

    const roles = results.map((r) => (r.ok ? r.user.role : "failed")).sort();
    expect(roles).toEqual([
      ROLES.AccountAdmin,
      ROLES.Reader,
      ROLES.Reader,
      ROLES.Reader,
    ]);
  });
});

describe("failures a stranger can trigger", () => {
  it("reports a duplicate email as a flat rejection, revealing nothing", async () => {
    const accountId = await freshAccount();
    await signup(
      { accountId, email: "taken@example.com", password: "a-long-enough-password" },
      { store, passwords },
    );

    const again = await signup(
      { accountId, email: "taken@example.com", password: "a-long-enough-password" },
      { store, passwords },
    );

    // Identical to any other rejection. "That email is already registered" is
    // an account enumerator with a form in front of it.
    expect(again).toEqual({ ok: false, reason: "rejected" });
  });

  it("does not mistake a duplicate email for a lost admin race", async () => {
    // Both surface as the same Postgres unique violation. If the store retried
    // an email clash as a Reader and that somehow succeeded, one person would
    // hold two accounts.
    const accountId = await freshAccount();
    await signup(
      { accountId, email: "solo@example.com", password: "a-long-enough-password" },
      { store, passwords },
    );

    const dupe = await signup(
      { accountId, email: "solo@example.com", password: "a-long-enough-password" },
      { store, passwords },
    );

    expect(dupe).toEqual({ ok: false, reason: "rejected" });
    expect(await prisma.user.count({ where: { accountId } })).toBe(1);
  });
});
