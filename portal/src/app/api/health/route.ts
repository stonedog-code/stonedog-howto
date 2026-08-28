import { NextResponse } from "next/server";

import { prisma } from "../../../lib/db/client";

/**
 * Liveness, and it actually checks the database.
 *
 * A health endpoint that only proves the process is running reports healthy
 * while every request 500s on a dead connection — which is worse than none,
 * because something is watching it and concluding all is well.
 */
export async function GET(): Promise<NextResponse> {
  const version = process.env.APP_VERSION ?? "dev";
  const sha = process.env.GIT_SHA ?? "dev";

  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok", version, sha, database: "ok" });
  } catch {
    // The reason is deliberately not echoed: a connection error carries the
    // host, the port and sometimes the user.
    return NextResponse.json(
      { status: "degraded", version, sha, database: "unreachable" },
      { status: 503 },
    );
  }
}
