/**
 * `articles.json` — which repositories exist, and where their articles live.
 *
 * Parsed strictly and reported per entry. A config file is edited by hand, so
 * the interesting behaviour is what happens to a bad entry: it must name the
 * entry rather than fail the file, or one typo takes every repository offline.
 */

export interface RepoSource {
  /**
   * The repository's identity.
   *
   * Permissions and role mappings are keyed on this, not on the path — so a
   * repository that moves on disk keeps its configuration, and one removed and
   * re-added gets it back.
   */
  name: string;
  /** Absolute path to the directory holding its `.md` articles. */
  path: string;
}

export interface ConfigProblem {
  /** Index in the `repos` array, so a nameless entry is still findable. */
  index: number;
  message: string;
}

export interface ParsedConfig {
  repos: RepoSource[];
  problems: ConfigProblem[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parse the contents of `articles.json`.
 *
 * Returns the entries it understood **and** the problems it found, rather than
 * throwing on the first bad one. A run that reported only the first problem
 * would need as many runs as there are typos.
 */
export function parseConfig(raw: string): ParsedConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      repos: [],
      problems: [
        {
          index: -1,
          message: `articles.json is not valid JSON: ${
            error instanceof Error ? error.message : "unparseable"
          }`,
        },
      ],
    };
  }

  if (!isObject(parsed) || !Array.isArray(parsed.repos)) {
    return {
      repos: [],
      problems: [{ index: -1, message: "articles.json must be an object with a `repos` array" }],
    };
  }

  const repos: RepoSource[] = [];
  const problems: ConfigProblem[] = [];
  const seen = new Map<string, number>();

  parsed.repos.forEach((entry: unknown, index: number) => {
    if (!isObject(entry)) {
      problems.push({ index, message: `entry ${index} is not an object` });
      return;
    }

    const name = typeof entry.name === "string" ? entry.name.trim() : "";
    const path = typeof entry.path === "string" ? entry.path.trim() : "";

    if (name === "") {
      problems.push({ index, message: `entry ${index} has no \`name\`` });
      return;
    }
    if (path === "") {
      problems.push({ index, message: `\`${name}\` has no \`path\`` });
      return;
    }

    // Two entries claiming one name would make the identity ambiguous, and the
    // mapping keyed on it would silently belong to whichever won.
    const previous = seen.get(name);
    if (previous !== undefined) {
      problems.push({
        index,
        message: `\`${name}\` is declared twice (entries ${previous} and ${index}); the name is the identity, so it must be unique`,
      });
      return;
    }

    seen.set(name, index);
    repos.push({ name, path });
  });

  return { repos, problems };
}
