"use server";

import { revalidatePath } from "next/cache";

import { type PortalRole } from "../../../lib/capabilities";
import { prisma } from "../../../lib/db/client";
import { grantChanges, readRequestedGrants, type GrantRow } from "../../../lib/grants";
import { userCan } from "../../../lib/rbac";
import { currentUser } from "../../../lib/session/session";

/**
 * Save one person's repository grants.
 *
 * Re-authorises on the server, and re-reads the account from the database
 * rather than trusting anything the form said about it. The page already hides
 * what this person may not touch, but a hidden field is a rendering decision
 * and a POST is a request — `saveMappingAction` says the same and this is the
 * sharper case, because the thing being edited is who may read what.
 */
export async function saveGrantsAction(form: FormData): Promise<void> {
  const actor = await currentUser();
  if (actor === null) throw new Error("Not signed in.");

  if (!userCan(actor, "member:manage")) {
    throw new Error("That member could not be updated.");
  }

  const targetUserId = String(form.get("userId") ?? "");
  if (targetUserId === "") throw new Error("No member named.");

  // The actor's account comes from the database, never from the form. Reading
  // it from a hidden field would make "which account am I administering" an
  // answer the caller supplies.
  const actorRow = await prisma.user.findUnique({
    where: { id: actor.id },
    select: { accountId: true },
  });
  if (actorRow === null) throw new Error("Not signed in.");

  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, accountId: true },
  });

  // Deliberately the same message whether the user does not exist or belongs to
  // another account. Distinguishing them turns this into an oracle for which
  // user ids are real, which is exactly what `saveMappingAction` refuses to do
  // for repositories.
  if (target === null || target.accountId !== actorRow.accountId) {
    throw new Error("That member could not be updated.");
  }

  // The repositories this save is allowed to have an opinion about: the
  // account's own, which is also the set the page offered.
  const repos = await prisma.repo.findMany({
    where: { accountId: actorRow.accountId },
    select: { id: true },
  });
  const offered = new Set(repos.map((repo) => repo.id));

  const requested: GrantRow[] = [];
  for (const repoId of offered) {
    for (const role of form.getAll(`grant:${repoId}`).map(String)) {
      requested.push({ repoId, role: role as PortalRole });
    }
  }

  const { grants: desired } = readRequestedGrants(requested, offered);

  const current: GrantRow[] = (
    await prisma.repoGrant.findMany({
      where: { userId: target.id },
      select: { repoId: true, role: true },
    })
  ).map((row) => ({ repoId: row.repoId, role: row.role as PortalRole }));

  const { add, remove } = grantChanges(current, desired, offered);

  // One transaction. A half-applied save would leave somebody holding a set of
  // grants nobody chose — and the removals landing without the additions is the
  // shape that locks a person out of what they could read a moment ago.
  await prisma.$transaction([
    ...remove.map((grant) =>
      prisma.repoGrant.deleteMany({
        where: { userId: target.id, repoId: grant.repoId, role: grant.role },
      }),
    ),
    ...add.map((grant) =>
      prisma.repoGrant.create({
        data: { userId: target.id, repoId: grant.repoId, role: grant.role },
      }),
    ),
  ]);

  revalidatePath("/admin/members");
  // The reader's own view changes immediately: `currentUser` re-reads grants on
  // every call, so a revoked grant stops working on their next request rather
  // than when a cookie expires.
  revalidatePath("/repos");
}
