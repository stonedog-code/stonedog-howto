/**
 * The signed-in reader, as a cookie.
 *
 * Deliberately small: an HTTP-only cookie holding a signed user id, verified on
 * every request against the database. No roles, no grants, no repository list
 * in the cookie — those change while a session is open, and a cookie that
 * carried them would keep answering with the access somebody had at login.
 * Revoking a grant has to take effect on the next request, not the next login.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import { cookies } from "next/headers";

import { prisma } from "../db/client";
import type { PortalRole } from "../capabilities";
import type { PortalUser } from "../rbac";

export const SESSION_COOKIE = "howto_session";

function secret(): string {
  const value = process.env.SESSION_SECRET;
  // Refuses rather than falling back to a default. A signing key with a known
  // value is not a signing key, and the failure of a baked-in default is
  // silent: everything works, and anybody can mint a session.
  if (!value || value.length < 32) {
    throw new Error("SESSION_SECRET must be set and at least 32 characters.");
  }
  return value;
}

function sign(userId: string): string {
  return createHmac("sha256", secret()).update(userId).digest("hex");
}

/** `<userId>.<signature>`, so a tampered id fails before it reaches the database. */
export function serialiseSession(userId: string): string {
  return `${userId}.${sign(userId)}`;
}

export function parseSession(raw: string | undefined): string | null {
  if (!raw) return null;
  const separator = raw.lastIndexOf(".");
  if (separator <= 0) return null;

  const userId = raw.slice(0, separator);
  const provided = Buffer.from(raw.slice(separator + 1), "hex");
  const expected = Buffer.from(sign(userId), "hex");

  // Length-checked first: timingSafeEqual throws on a length mismatch, and a
  // thrown error here would distinguish "wrong length" from "wrong value".
  if (provided.length !== expected.length) return null;
  return timingSafeEqual(provided, expected) ? userId : null;
}

/**
 * The signed-in user, with the grants they hold **right now**.
 *
 * Read from the database on every call rather than cached in the cookie, so a
 * revoked grant stops working immediately. Returns null for a missing,
 * tampered, or deleted user — all indistinguishable to the caller.
 */
export async function currentUser(): Promise<PortalUser | null> {
  const store = await cookies();
  const userId = parseSession(store.get(SESSION_COOKIE)?.value);
  if (userId === null) return null;

  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, grants: { select: { role: true, repoId: true } } },
  });
  if (row === null) return null;

  return {
    id: row.id,
    accountRole: row.role as PortalRole,
    grants: row.grants.map((grant) => ({
      role: grant.role as PortalRole,
      repoId: grant.repoId,
    })),
  };
}
