/**
 * The Prisma client, as one instance.
 *
 * Cached on `globalThis` in development because Next.js hot-reloads modules on
 * every edit, and a fresh `PrismaClient` per reload exhausts the database's
 * connection limit within a few minutes of editing. In production the module
 * is evaluated once and the cache is never read.
 */

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
