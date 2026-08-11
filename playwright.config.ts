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
export default defineConfig({
  testDir: "./test/e2e",
  // A retry hides a flake, and a flaky access-control test is a finding.
  retries: 0,
  timeout: 30_000,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: "http://localhost:5199",
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
    command: "npm run dev --workspace @stonedogcode/howto-demo -- --port 5199 --strictPort",
    url: "http://localhost:5199",
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "ignore",
  },
});
