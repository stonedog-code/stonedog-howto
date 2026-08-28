/**
 * The check that would have caught the five-day outage.
 *
 * The sync's exit status was built around SKIPPED articles, which is the right
 * thing to notice and misses the larger one: a repository that never reads an
 * article skips nothing, so a run taking zero articles from every repository it
 * has exited 0 and logged `sync finished cleanly`.
 */

import { attentionSummary, needsAttention, type AttentionCandidate } from "../attention";

const repo = (over: Partial<AttentionCandidate> = {}): AttentionCandidate => ({
  name: "Hopperguard",
  outcome: "synced",
  articlesTaken: 109,
  ...over,
});

describe("repositories that ended a run serving nothing", () => {
  it("says nothing about a repository that synced articles", () => {
    expect(needsAttention([repo()])).toEqual([]);
    expect(attentionSummary([repo()])).toEqual([]);
  });

  it("catches the path-changed repository that reported success for five days", () => {
    // The exact state the portal was in: the config named the real path, the
    // database held `/x` under the same name, and the sync correctly refused to
    // follow it. Correct refusal, zero skips, exit 0.
    const stuck = repo({
      outcome: "path-changed",
      articlesTaken: 0,
      note: "path changed from /x to /srv/content/... — not followed; an admin must re-confirm",
    });

    expect(needsAttention([stuck])).toHaveLength(1);
    expect(attentionSummary([stuck])[0]).toContain("path-changed, serving nothing");
    // The note is what tells the operator which of the three actions to take.
    expect(attentionSummary([stuck])[0]).toContain("an admin must re-confirm");
  });

  it("catches a repository nobody has mapped, and one whose path cannot be read", () => {
    const unconfigured = repo({ name: "Rozcards", outcome: "unconfigured", articlesTaken: 0 });
    const unreadable = repo({ name: "Optima", outcome: "unreadable", articlesTaken: 0 });

    expect(needsAttention([unconfigured, unreadable]).map((r) => r.name)).toEqual([
      "Rozcards",
      "Optima",
    ]);
  });

  it("stays quiet about a dormant repository, because removing one is deliberate", () => {
    // Dormant means the UI knows it and the config no longer names it —
    // somebody took it out. A job that failed hourly over that would teach its
    // reader to ignore a red exit status, which costs more than it saves.
    expect(needsAttention([repo({ outcome: "dormant", articlesTaken: 0 })])).toEqual([]);
  });

  it("catches a repository that reports synced and took nothing", () => {
    // An outcome and a count disagreeing: either the directory is empty or the
    // loader found no files where somebody expected some. Invisible otherwise.
    expect(needsAttention([repo({ articlesTaken: 0 })])).toHaveLength(1);
  });

  it("reports every affected repository, not just the first", () => {
    const reports = [
      repo({ name: "A", outcome: "path-changed", articlesTaken: 0 }),
      repo({ name: "B" }),
      repo({ name: "C", outcome: "unreadable", articlesTaken: 0 }),
    ];
    // One run must be enough to see all of them. A check reporting only the
    // first needs as many hourly runs as there are broken repositories.
    expect(needsAttention(reports).map((r) => r.name)).toEqual(["A", "C"]);
  });
});
