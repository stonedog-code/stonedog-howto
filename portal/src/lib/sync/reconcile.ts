/**
 * Reconciling `articles.json` against the repositories the UI already knows.
 *
 * Two sources of truth that can disagree in both directions, and each direction
 * needs the opposite treatment. Kept as a pure function over plain data so the
 * decision can be tested without a database — it is the part most likely to be
 * got wrong and the least likely to be noticed.
 */

import type { RepoSource } from "./config";

export type RepoStatus = "Active" | "Unconfigured" | "Dormant";

/** What the portal already holds for a repository. */
export interface KnownRepo {
  id: string;
  name: string;
  path: string | null;
  status: RepoStatus;
  /** Whether an admin has mapped any of its roles yet. */
  isConfigured: boolean;
}

export type RepoAction =
  /** In the config and mapped: sync it. */
  | { kind: "sync"; name: string; path: string; id: string }
  /** In the config, never mapped: adopt it, sync NOTHING, ask an admin. */
  | { kind: "adopt"; name: string; path: string; id?: string }
  /** Gone from the config: hide its articles, keep its mapping. */
  | { kind: "dormant"; name: string; id: string }
  /**
   * Same name, different path. Not followed automatically — a mapping is
   * attached to a name, and silently re-pointing it at another directory would
   * apply somebody's carefully chosen permissions to articles they have never
   * seen.
   */
  | { kind: "path-changed"; name: string; id: string; from: string; to: string };

export interface Reconciliation {
  actions: RepoAction[];
  /** Human-readable, in the order an operator wants to read them. */
  notes: string[];
}

export function reconcile(
  configured: readonly RepoSource[],
  known: readonly KnownRepo[],
): Reconciliation {
  const byName = new Map(known.map((repo) => [repo.name, repo]));
  const inConfig = new Set(configured.map((repo) => repo.name));

  const actions: RepoAction[] = [];
  const notes: string[] = [];

  for (const source of configured) {
    const existing = byName.get(source.name);

    if (existing === undefined) {
      actions.push({ kind: "adopt", name: source.name, path: source.path });
      notes.push(`${source.name}: new, and unconfigured — nothing will sync until its roles are mapped`);
      continue;
    }

    if (existing.path !== null && existing.path !== source.path) {
      actions.push({
        kind: "path-changed",
        name: source.name,
        id: existing.id,
        from: existing.path,
        to: source.path,
      });
      notes.push(
        `${source.name}: path changed from ${existing.path} to ${source.path} — not followed; an admin must re-confirm`,
      );
      continue;
    }

    if (!existing.isConfigured) {
      actions.push({ kind: "adopt", name: source.name, path: source.path, id: existing.id });
      notes.push(`${source.name}: still unconfigured — nothing synced`);
      continue;
    }

    actions.push({ kind: "sync", name: source.name, path: source.path, id: existing.id });
  }

  for (const repo of known) {
    if (inConfig.has(repo.name)) continue;
    if (repo.status === "Dormant") continue;

    actions.push({ kind: "dormant", name: repo.name, id: repo.id });
    notes.push(
      `${repo.name}: no longer in articles.json — articles hidden, mapping kept so re-adding the name restores it`,
    );
  }

  return { actions, notes };
}
