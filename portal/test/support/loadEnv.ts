/**
 * Load `.env` for the test tooling, explicitly.
 *
 * Next.js loads `.env` for the application, and Prisma loads it for its CLI —
 * so the two things a developer runs by hand both work, and it is easy to
 * conclude that `.env` is simply always loaded. It is not. Neither jest nor
 * Playwright loads it, and what they see is whatever the shell exported.
 *
 * The integration tier appeared to prove otherwise, which is the trap worth
 * recording: its `globalSetup` imports `PrismaClient`, Prisma Client loads
 * `.env` as an import side effect, and the workers then FORK from that process
 * and inherit the result. So the redirect to the test database worked — via a
 * side effect of an import that had nothing to do with it, in a file that would
 * have stopped working the day somebody removed the Prisma import for being
 * unused. Playwright, which forks nothing from that process, failed outright:
 *
 *     Error: DATABASE_URL is not set, so the test database cannot be derived
 *
 * That error is the good outcome — the derivation refuses rather than guessing,
 * so the worst case was a red suite and not a run against the portal's data.
 * Loading `.env` here makes the dependency real instead of incidental.
 *
 * `dotenv` never overwrites a variable that is already set, so an explicit
 * `DATABASE_URL=… npx playwright test` still wins, and CI — which exports its
 * own and ships no `.env` — is unaffected.
 */

import { config } from "dotenv";

config();
