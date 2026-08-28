/**
 * Mint an API token for a user.
 *
 * The plaintext is printed ONCE and never stored — only its SHA-256 goes to the
 * database. A token you can look up later is a token an attacker can look up
 * later, and "we can re-read it for you" is what makes people stop treating it
 * as a secret.
 *
 *   npx tsx scripts/mint-token.ts <email> "<what it is for>"
 */
import { randomBytes } from "node:crypto";

import { PrismaClient } from "@prisma/client";

import { hashToken } from "../src/lib/api/token";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const [email, name] = process.argv.slice(2);
  if (!email || !name) {
    console.error('usage: tsx scripts/mint-token.ts <email> "<what it is for>"');
    process.exit(1);
  }

  const user = await prisma.user.findFirst({ where: { email }, select: { id: true, role: true } });
  if (user === null) {
    console.error(`no user with email ${email}`);
    process.exit(1);
  }

  const token = randomBytes(32).toString("base64url");
  await prisma.apiToken.create({
    data: { userId: user.id, name, tokenHash: hashToken(token) },
  });

  console.log(`token for ${email} (${user.role}), named "${name}":\n`);
  console.log(token);
  console.log(
    "\nStored hashed. It cannot be shown again — mint another if it is lost.\n" +
      "It reads exactly what this person reads, so scope it by choosing the person.",
  );

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
