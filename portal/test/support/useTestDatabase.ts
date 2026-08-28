/**
 * Point this process at the test database, before anything constructs a client.
 *
 * Loaded as `setupFiles` — which jest runs before the test framework and before
 * a single test module is imported. That ordering is the whole mechanism:
 * `PrismaClient` resolves `DATABASE_URL` when it is constructed, and the
 * integration files construct theirs at module scope, so a redirect applied any
 * later would arrive after the connection it was meant to redirect.
 *
 * `process.env` beats `.env`, which is what makes this work at all: Prisma
 * loads `.env` without overriding variables that are already set, so assigning
 * here wins over the portal's own URL sitting in the file next door.
 */

import "./loadEnv";
import { testDatabaseUrl } from "../../src/lib/db/testDatabaseUrl";

const url = testDatabaseUrl(process.env.DATABASE_URL);

process.env.DATABASE_URL = url;
process.env.DATABASE_DIRECT_URL = url;
