import { defineConfig } from "@playwright/test";

/**
 * The E2E tier (NEH-440).
 *
 * It runs against the demo, which is the package's only browser surface — and
 * that is the point rather than a compromise. The demo is the worked example
 * consumers copy from, and the three things asserted here are exactly the ones
 * no lower tier can reach:
 *
 *  - a TOC link actually MOVES the page. The anchor ids are produced by one
 *    pass and consumed by another; when they disagree the link renders, is
 *    clickable, and does nothing. jsdom has no layout and no scrolling, so it
 *    agrees with a broken anchor.
 *  - search filters what is on screen, not just what a function returns.
 *  - a reader without the role sees neither the article NOR its title. The unit
 *    and integration tiers assert the payload; only a browser can say what was
 *    actually painted.
 */
/**
 * The port, overridable.
 *
 * 5199 stays the default so an unqualified `npm run test:e2e` behaves exactly as
 * before. The override exists because `--strictPort` turns a collision into a
 * hard failure by design, and on a machine running several of these projects at
 * once the collision is with something entirely unrelated — at which point the
 * only way to run the suite is to stop the other app. An env var is cheaper than
 * that, and it cannot drift, because both the server and the baseURL read it.
 */
const PORT = process.env.HOWTO_E2E_PORT ?? "5199";
const ORIGIN = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./test/e2e",
  // A retry hides a flake, and a flaky access-control test is a finding.
  retries: 0,
  timeout: 30_000,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: ORIGIN,
    trace: "retain-on-failure",
  },
  webServer: {
    // An explicit port with `--strictPort`, NOT vite's default.
    //
    // Vite silently INCREMENTS when its port is taken — asked for 5173 it will
    // serve 5174 and say so only in a line nobody reads. A suite pointed at the
    // default then either times out for no visible reason (what happened while
    // writing this), or worse, attaches to whatever other app is on 5173 and
    // reports on that. `--strictPort` turns the collision into an immediate,
    // named failure.
    //
    // Started here rather than reused. `reuseExistingServer: false` is
    // deliberate: a suite passing against a server somebody left running proves
    // nothing about this commit, and a dead process still holding the port
    // looks identical to a slow start.
    // Targets the demo workspace directly. The root `dev` script is itself an
    // `npm run --workspace` call, so `npm run dev -- --port …` is swallowed by
    // the OUTER npm ("Unknown cli config --port") and vite never sees it — the
    // args vanish silently and the server comes up on the default port.
    command: `npm run dev --workspace @stonedogcode/howto-demo -- --port ${PORT} --strictPort`,
    url: ORIGIN,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "ignore",
  },
});
