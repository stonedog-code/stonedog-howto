/**
 * Turning a portal user into the `HowToViewer` that `@stonedogcode/howto` asks
 * for, in one repository.
 *
 * This is where the two role vocabularies meet. A portal user holds *portal*
 * roles — Guest, Reader, Writer, AccountAdmin. A synced article names the roles
 * its *source application* wrote — `Organization Admin`, `Facility Admin`,
 * `Artwork Admin`. The names coincide only by accident, and where they coincide
 * by accident they are at their most dangerous: one application's `Admin`
 * silently meaning another's.
 *
 * So nothing is inferred. An account admin writes a mapping per repository, and
 * that mapping is the only thing that grants.
 */

import { mappedRoleViewer, type HowToViewer } from "@stonedogcode/howto";

import type { PortalRole } from "./capabilities";
import {
  isSystemAdmin,
  portalRolesInRepo,
  userCan,
  type PortalUser,
  type RepoId,
} from "./rbac";

/** One row of a repository's role mapping, as stored. */
export interface RepoRoleMapping {
  /** The portal role this row is about. */
  role: PortalRole;
  /** Source role names this portal role may read in this repository. */
  sourceRoles: readonly string[];
  /**
   * Grants every source role, including ones that appear after this row was
   * written. For a reader trusted with a whole body of documentation.
   */
  allSourceRoles: boolean;
  /**
   * Whether this portal role may read articles that declare **no** roles.
   *
   * Separate from `allSourceRoles` on purpose. An article with no roles has no
   * role to be granted — its problem is that it is unfinished, not that it is
   * exclusive — so "may read every role" must not quietly also mean "may read
   * the ones nobody classified".
   */
  seesUnclassified: boolean;
}

/** Sees nothing at all. Not exported: a viewer this blind is only ever a result. */
const SEES_NOTHING: HowToViewer = { canSee: () => false };

/**
 * What this user may read in this repository.
 *
 * Three questions, in order, and the order matters:
 *
 * 1. **May they read here at all?** A grant in another repository, or none,
 *    ends it — before any mapping is consulted, so a mapping row cannot
 *    resurrect access the grant never gave.
 * 2. **Are they the operator?** A system admin reads everything, including
 *    articles that declare no roles. That is the whole point of the missing
 *    roles rule: those articles reach the person expected to fix them, and
 *    nobody else.
 * 3. **Otherwise, what does the mapping say?** Only the rows for roles they
 *    actually hold, and **absence denies** — a source role nobody mapped is a
 *    source role nobody can read.
 *
 * That last property is what makes the mapping safe to get wrong. A mistake
 * *hides* articles, which the reader who cannot find one complains about; the
 * alternative — where an unrecognised name fails to restrict anything —
 * *reveals* them, and nobody complains about being shown too much. Only one of
 * those two failures reports itself.
 */
export function viewerForRepo(
  user: PortalUser,
  repoId: RepoId,
  mappings: readonly RepoRoleMapping[],
): HowToViewer {
  if (!userCan(user, "article:read", repoId)) return SEES_NOTHING;

  // The operator's reach is a capability held globally, not a portal role
  // assigned in a repository — so it is answered here rather than by inventing
  // a mapping row for them. `portalRolesInRepo` deliberately returns nothing
  // for a system admin, and a mapping-shaped bypass would show up on the
  // mapping screen as though an admin had configured it.
  if (isSystemAdmin(user)) return { canSee: () => true };

  const held = portalRolesInRepo(user, repoId);
  if (held.length === 0) return SEES_NOTHING;

  const heldSet = new Set<string>(held);
  const relevant = mappings.filter((mapping) => heldSet.has(mapping.role));

  // One row per (repository, role) — the store enforces it with a unique
  // constraint — so this is an assignment, not a merge.
  const mapping: Record<string, readonly string[] | "*"> = {};
  for (const row of relevant) {
    mapping[row.role] = row.allSourceRoles ? "*" : [...row.sourceRoles];
  }

  // Computed from the rows for roles this person HOLDS, never from the whole
  // mapping: a row granting the unclassified articles to some other role must
  // not leak them to this one.
  const seesUnclassified = relevant.some((row) => row.seesUnclassified);

  return mappedRoleViewer({
    viewerRoles: held,
    mapping,
    unrestricted: seesUnclassified ? "allow" : "deny",
  });
}

/**
 * Every source role name this user may read in this repository, for display.
 *
 * The mapping screen needs to show an admin what a role currently resolves to,
 * and a reader deciding whether an article applies to them is helped by seeing
 * the provenance. Returns `"*"` when every source role is granted, because
 * enumerating names the mapping never listed would be a different claim.
 */
export function grantedSourceRoles(
  user: PortalUser,
  repoId: RepoId,
  mappings: readonly RepoRoleMapping[],
): string[] | "*" {
  if (!userCan(user, "article:read", repoId)) return [];
  if (isSystemAdmin(user)) return "*";

  const held = new Set<string>(portalRolesInRepo(user, repoId));
  const relevant = mappings.filter((mapping) => held.has(mapping.role));

  if (relevant.some((row) => row.allSourceRoles)) return "*";
  return [...new Set(relevant.flatMap((row) => [...row.sourceRoles]))].sort();
}
