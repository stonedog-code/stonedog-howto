-- A long-lived credential for a non-browser client (the MCP server).
--
-- Bound to a user, so it reads exactly what that person reads. There is
-- deliberately no token-level scope: a second, parallel permission model is how
-- a token ends up outliving the access it was minted alongside.
CREATE TABLE "api_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    -- SHA-256 of the token, never the token. It lives in a config file on
    -- somebody's disk; a database copy that also yields working credentials
    -- turns one leak into two.
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "api_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "api_tokens_tokenHash_key" ON "api_tokens"("tokenHash");
CREATE INDEX "api_tokens_userId_idx" ON "api_tokens"("userId");

-- Cascade, so revoking a person revokes their tokens in the same statement.
-- A token that outlives its user is a credential belonging to nobody.
ALTER TABLE "api_tokens"
  ADD CONSTRAINT "api_tokens_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
