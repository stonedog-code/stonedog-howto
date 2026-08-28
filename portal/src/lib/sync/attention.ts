/**
 * Which repositories a sync run left serving nothing.
 *
 * ## Why this is not just "did anything get skipped"
 *
 * `sync-once.ts` exits non-zero when articles were **skipped**, so an
 * unattended run cannot report success while quietly losing files. That rule is
 * right and it has a hole exactly one size too big to see: a repository that
 * never got as far as *reading* an article skips nothing. Zero skipped, zero
 * taken, exit 0.
 *
 * The portal ran that way for five days. Its one repository sat in
 * `path-changed` — the correct refusal to follow a path change under a reused
 * name — and every hourly run printed the reason and then said:
 *
 *     total: 0 taken, 0 skipped, 0 missing roles, 0 removed
 *     sync finished cleanly
 *
 * "Finished cleanly" while serving nothing at all. The prose was accurate and
 * the verdict was not, and the verdict is the half anything automated reads.
 *
 * ## The rule
 *
 * **A repository named in `articles.json` that took no articles needs
 * attention.** That is the whole test, and it is stated in terms of the config
 * because the config is the declaration of intent: somebody wrote that entry to
 * have those articles in the portal, and they are not in the portal.
 *
 * `dormant` is deliberately *not* included, and it is the one outcome that
 * proves the rule is about intent rather than about emptiness. A dormant
 * repository is one the UI knows and the config no longer names — somebody
 * removed it. Nothing is wrong, nobody needs to act, and a job that failed
 * hourly over it would be teaching its reader to ignore a red exit status,
 * which costs more than it could ever save.
 */

/** How a repository ended a sync run. */
export type RepoOutcome = "synced" | "unconfigured" | "dormant" | "path-changed" | "unreadable";

/** The part of a repository's report this decision reads. */
export interface AttentionCandidate {
  name: string;
  outcome: RepoOutcome;
  articlesTaken: number;
  note?: string;
}

/**
 * Outcomes reached only by a repository the config names.
 *
 * `synced` is the success. The other three are each a distinct way for a
 * configured repository to serve nothing, and each needs a different person to
 * do a different thing — which is why the outcome is reported rather than
 * flattened to a boolean.
 */
const CONFIGURED_BUT_NOT_SERVING: readonly RepoOutcome[] = [
  // In `articles.json`, never mapped in the UI. An admin must map its roles.
  "unconfigured",
  // The name is known at a different path. An admin must re-confirm the move.
  "path-changed",
  // The directory could not be read. Somebody must fix the path or the tree.
  "unreadable",
];

/**
 * The repositories that ended this run serving nothing, despite the config
 * naming them.
 *
 * `articlesTaken === 0` is checked as well as the outcome, rather than trusting
 * the outcome alone: a repository that reports `synced` and took nothing is
 * either an empty directory or a loader that silently found no files, and both
 * are worth a human look. An outcome and a count disagreeing is exactly the
 * kind of thing that should not pass quietly.
 */
export function needsAttention<T extends AttentionCandidate>(repos: readonly T[]): T[] {
  return repos.filter((repo) => {
    // Removed from the config on purpose. Nothing to do, so nothing to report.
    if (repo.outcome === "dormant") return false;
    if (CONFIGURED_BUT_NOT_SERVING.includes(repo.outcome)) return true;
    // `synced` and empty: either the directory holds no articles, or the loader
    // found none where somebody expected some. Both deserve a look, and the
    // second is invisible without this.
    return repo.articlesTaken === 0;
  });
}

/** One line per repository needing attention, for an operator reading a log. */
export function attentionSummary(repos: readonly AttentionCandidate[]): string[] {
  return needsAttention(repos).map(
    (repo) =>
      `${repo.name}: ${repo.outcome}, serving nothing` + (repo.note ? ` — ${repo.note}` : ""),
  );
}
