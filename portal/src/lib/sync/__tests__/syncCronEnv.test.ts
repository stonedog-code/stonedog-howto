/**
 * sync-cron.sh must hand the sync its DATABASE_URL itself.
 *
 * Prisma does not find the portal's .env on its own here: the workspace hoists
 * the generated client to the repository root, and a client generated there
 * carries `rootEnvPath: null` and no schema env path, so it loads no .env at
 * all. From 2026-08-29 every hourly run died with "Environment variable not
 * found: DATABASE_URL" while a correct .env sat beside the script.
 *
 * These run the REAL script against a staged copy of the portal, with a stub
 * `npm` that reports what the sync would have seen. The stub stands in for
 * `npm run sync` only; node, bash and the script itself are real.
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(process.cwd(), "scripts", "sync-cron.sh");

const staged: string[] = [];

afterAll(() => {
  for (const dir of staged) rmSync(dir, { recursive: true, force: true });
});

/** A throwaway portal: the script, an optional .env, and no repositories. */
function stage(envFile: string | null): string {
  const root = mkdtempSync(join(tmpdir(), "sync-cron-env-"));
  staged.push(root);

  mkdirSync(join(root, "portal", "scripts"), { recursive: true });
  copyFileSync(SCRIPT, join(root, "portal", "scripts", "sync-cron.sh"));
  if (envFile !== null) writeFileSync(join(root, "portal", ".env"), envFile);
  writeFileSync(join(root, "articles.json"), JSON.stringify({ repos: [] }));

  // node is the real interpreter; npm is the stub. They share a directory so
  // the script's own node resolution puts the stub first on PATH.
  const bin = join(root, "bin");
  mkdirSync(bin);
  symlinkSync(process.execPath, join(bin, "node"));
  writeFileSync(
    join(bin, "npm"),
    '#!/bin/sh\nprintf "npm-saw DATABASE_URL=%s\\n" "${DATABASE_URL:-<unset>}"\n',
  );
  chmodSync(join(bin, "npm"), 0o755);
  return root;
}

function run(root: string, extraEnv: Record<string, string> = {}) {
  const result = spawnSync("bash", [join(root, "portal", "scripts", "sync-cron.sh")], {
    encoding: "utf8",
    // Deliberately NOT process.env: a DATABASE_URL exported in the shell that
    // runs the suite would make every case pass for the wrong reason.
    env: {
      PATH: `${join(root, "bin")}:/usr/bin:/bin`,
      HOME: root,
      NVM_DIR: join(root, "no-nvm"),
      ARTICLES_CONFIG: join(root, "articles.json"),
      ...extraEnv,
    },
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe("sync-cron.sh DATABASE_URL", () => {
  it("passes the portal's .env DATABASE_URL to the sync", () => {
    const { status, output } = run(stage("DATABASE_URL=postgresql://from-env-file/howto\n"));

    expect(output).toContain("npm-saw DATABASE_URL=postgresql://from-env-file/howto");
    expect(status).toBe(0);
  });

  it("names what it loaded without printing the value", () => {
    const { output } = run(stage("DATABASE_URL=postgresql://secret-part/howto\n"));

    // Once, from the stub. The script's own log line carries the NAME only.
    expect(output.split("secret-part").length - 1).toBe(1);
    expect(output).toMatch(/loaded 1 name\(s\) from .*\.env: DATABASE_URL/);
  });

  it("strips quotes and ignores comments and blank lines", () => {
    const { output } = run(
      stage('# the local portal\n\nDATABASE_URL="postgresql://quoted/howto"\n'),
    );

    expect(output).toContain("npm-saw DATABASE_URL=postgresql://quoted/howto");
  });

  it("lets a DATABASE_URL already in the environment win over the file", () => {
    const { output } = run(stage("DATABASE_URL=postgresql://from-env-file/howto\n"), {
      DATABASE_URL: "postgresql://from-operator/howto",
    });

    expect(output).toContain("npm-saw DATABASE_URL=postgresql://from-operator/howto");
  });

  it("refuses to start, by name, when nothing provides DATABASE_URL", () => {
    const { status, output } = run(stage(null));

    expect(status).toBe(1);
    expect(output).toContain("FATAL DATABASE_URL is not set");
    // The sync never ran, so its Prisma stack trace never buries the reason.
    expect(output).not.toContain("npm-saw");
  });
});
