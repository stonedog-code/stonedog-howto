/**
 * The real `SignupStore`, backed by PostgreSQL.
 *
 * The fake in the unit tests models the admin-slot constraint correctly, which
 * is exactly why it cannot prove anything: a fake that behaves correctly agrees
 * with a schema that has no constraint at all. This file is the half that can
 * be wrong, and the integration tier is what checks it.
 */

import { Prisma, type PrismaClient } from "@prisma/client";

import { ADMINISTRATOR_ROLES, ROLES, type PortalRole } from "../capabilities";
import type { SignupStore } from "../signup";

/**
 * Postgres raises this when a unique index rejects a row. The first admin race
 * is resolved by exactly that, so the code has to recognise it rather than
 * treat every failure as fatal.
 */
const UNIQUE_VIOLATION = "P2002";

/**
 * The admin slot is claimed by INSERTING, not by counting.
 *
 * `createUser` attempts the role it was asked for. When that is `AccountAdmin`
 * and somebody already holds the slot, the partial unique index
 * `users_one_account_admin_per_account` rejects the row — and the loser is
 * retried **as a Reader** rather than told the signup failed. Losing a race you
 * did not know you were in should not cost you your account.
 *
 * The retry cannot loop: the second attempt asks for `Reader`, which no unique
 * index constrains, so it either succeeds or fails for an unrelated reason
 * (a duplicate email) that `signup` reports as a flat rejection.
 */
export function prismaSignupStore(prisma: PrismaClient): SignupStore {
  return {
    async accountHasAdmin(accountId: string): Promise<boolean> {
      // Note what this does NOT ask: whether the account row exists. Accounts
      // are created before anybody signs up to them, so an existence test is
      // always true and nobody ever asks for the admin role — leaving the
      // account with no admin and nothing failing to say so.
      //
      // It asks about ADMINISTRATORS, plural in kind: `AccountAdmin` or
      // `SystemAdmin`. Asking only about `AccountAdmin` was the narrower
      // reading and it handed accounts away.
      //
      // The bring-up in the README promotes the first admin to `SystemAdmin`,
      // because that role is deliberately assigned out of band. Under the old
      // query the account then had no admin — honestly, by that query's own
      // definition — so the NEXT person to sign up was offered the role and the
      // partial unique index granted it. Signup needs an account id and a
      // password of the signer's choosing and nothing else, so on any
      // deployment where the operator had done what the README says, the next
      // stranger to guess the account id became its administrator. Reproduced
      // exactly that way on 2026-08-14.
      //
      // `SystemAdmin` still is not an *account* role and is still not
      // assignable by an account — this is only the question "is this account
      // already looked after", and an operator sitting in it is an answer of
      // yes. See ADMINISTRATOR_ROLES for the list and why it is that list.
      const admin = await prisma.user.findFirst({
        where: { accountId, role: { in: [...ADMINISTRATOR_ROLES] } },
        select: { id: true },
      });
      return admin !== null;
    },

    async createUser({ accountId, email, passwordHash, desiredRole }) {
      const insert = async (role: PortalRole): Promise<{ id: string; role: PortalRole }> => {
        const user = await prisma.user.create({
          data: { accountId, email, passwordHash, role },
          select: { id: true, role: true },
        });
        return { id: user.id, role: user.role as PortalRole };
      };

      try {
        return await insert(desiredRole);
      } catch (error) {
        const lostTheAdminSlot =
          desiredRole === ROLES.AccountAdmin &&
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === UNIQUE_VIOLATION;

        // Anything else — a duplicate email, a dead connection — is the
        // caller's to report, and `signup` reports every one of them
        // identically so a stranger cannot tell them apart.
        if (!lostTheAdminSlot) throw error;

        return await insert(ROLES.Reader);
      }
    },
  };
}
