/**
 * Authenticating a non-browser client by bearer token.
 *
 * A token is bound to a user and carries no scope of its own. That is
 * deliberate: a token-level permission model would be a second, parallel answer
 * to "what may this read", and the two drift — a token keeps working after the
 * grant it was minted alongside is revoked, and nothing reports it.
 */

import { createHash, timingSafeEqual } from "node:crypto";

import { prisma } from "../db/client";
import type { PortalRole } from "../capabilities";
import type { PortalUser } from "../rbac";

/** Tokens are stored hashed; this is the only place that relationship lives. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * The user a bearer token belongs to, with the grants they hold **right now**.
 *
 * Read per request rather than cached, so revoking a grant takes effect on the
 * next call rather than whenever the client next restarts.
 */
export async function userFromAuthorization(
  header: string | null,
): Promise<PortalUser | null> {
  if (header === null) return null;

  const match = /^Bearer (.+)$/.exec(header.trim());
  if (match === null) return null;

  const presented = hashToken(match[1]!);

  // Looked up by the hash, which is unique and indexed — so this is one probe,
  // not a scan comparing every row.
  const row = await prisma.apiToken.findUnique({
    where: { tokenHash: presented },
    select: {
      id: true,
      tokenHash: true,
      user: {
        select: { id: true, role: true, grants: { select: { role: true, repoId: true } } },
      },
    },
  });
  if (row === null) return null;

  // Constant-time, even though the lookup already matched. The comparison is
  // cheap and it keeps the property true if this is ever changed to search.
  const stored = Buffer.from(row.tokenHash, "hex");
  const offered = Buffer.from(presented, "hex");
  if (stored.length !== offered.length || !timingSafeEqual(stored, offered)) return null;

  // Best-effort: a failure to record usage must not fail the request. It is
  // an operator convenience for spotting a token nobody uses any more, not an
  // audit record.
  void prisma.apiToken
    .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined);

  return {
    id: row.user.id,
    accountRole: row.user.role as PortalRole,
    grants: row.user.grants.map((grant) => ({
      role: grant.role as PortalRole,
      repoId: grant.repoId,
    })),
  };
}
