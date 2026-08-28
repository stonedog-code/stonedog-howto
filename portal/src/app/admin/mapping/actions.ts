"use server";

import { revalidatePath } from "next/cache";

import { ASSIGNABLE_ACCOUNT_ROLES, type PortalRole } from "../../../lib/capabilities";
import { prisma } from "../../../lib/db/client";
import { userCan } from "../../../lib/rbac";
import { currentUser } from "../../../lib/session/session";

/**
 * Save one repository's role mapping.
 *
 * Re-authorises on the server. The page already hides repositories this person
 * cannot configure, but a hidden form is a rendering decision and a POST is a
 * request — anybody can send one.
 */
export async function saveMappingAction(form: FormData): Promise<void> {
  const user = await currentUser();
  if (user === null) throw new Error("Not signed in.");

  const repoId = String(form.get("repoId") ?? "");
  if (repoId === "") throw new Error("No repository named.");

  if (!userCan(user, "mapping:manage", repoId)) {
    // Deliberately the same message whether the repository does not exist or
    // this person may not touch it. Distinguishing them confirms which
    // repositories exist to somebody probing ids.
    throw new Error("That repository could not be updated.");
  }

  for (const role of ASSIGNABLE_ACCOUNT_ROLES) {
    const sourceRoles = form.getAll(`grant:${role}`).map(String);
    const allSourceRoles = form.get(`all:${role}`) !== null;
    const seesUnclassified = form.get(`unclassified:${role}`) !== null;

    const grantsNothing =
      sourceRoles.length === 0 && !allSourceRoles && !seesUnclassified;

    // A row granting nothing is DELETED rather than stored empty. The two are
    // equivalent to the viewer -- absence denies -- but a stored empty row
    // reads on the mapping screen as "configured", and a repository with only
    // empty rows would count as configured and start syncing while granting
    // nobody anything.
    if (grantsNothing) {
      await prisma.roleMapping.deleteMany({ where: { repoId, role } });
      continue;
    }

    const fields = { sourceRoles, allSourceRoles, seesUnclassified };
    await prisma.roleMapping.upsert({
      where: { repoId_role: { repoId, role: role as PortalRole } },
      create: { repoId, role: role as PortalRole, ...fields },
      update: fields,
    });
  }

  revalidatePath("/admin/mapping");
  revalidatePath(`/repos/${repoId}`);
}
