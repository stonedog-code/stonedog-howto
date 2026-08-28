-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "PortalRole" AS ENUM ('Guest', 'Reader', 'Writer', 'AccountAdmin', 'SystemAdmin');

-- CreateEnum
CREATE TYPE "RepoStatus" AS ENUM ('Active', 'Unconfigured', 'Dormant');

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "PortalRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repos" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "path" TEXT,
    "status" "RepoStatus" NOT NULL DEFAULT 'Unconfigured',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repo_grants" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "role" "PortalRole" NOT NULL,

    CONSTRAINT "repo_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_mappings" (
    "id" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "role" "PortalRole" NOT NULL,
    "sourceRoles" TEXT[],
    "allSourceRoles" BOOLEAN NOT NULL DEFAULT false,
    "seesUnclassified" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "role_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "articles" (
    "id" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "summary" TEXT,
    "body" TEXT NOT NULL,
    "sourceRoles" TEXT[],
    "missingRoles" BOOLEAN NOT NULL DEFAULT false,
    "sourcePath" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "articles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "users_accountId_idx" ON "users"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "users_accountId_email_key" ON "users"("accountId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "repos_accountId_name_key" ON "repos"("accountId", "name");

-- CreateIndex
CREATE INDEX "repo_grants_repoId_idx" ON "repo_grants"("repoId");

-- CreateIndex
CREATE UNIQUE INDEX "repo_grants_userId_repoId_role_key" ON "repo_grants"("userId", "repoId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "role_mappings_repoId_role_key" ON "role_mappings"("repoId", "role");

-- CreateIndex
CREATE INDEX "articles_repoId_missingRoles_idx" ON "articles"("repoId", "missingRoles");

-- CreateIndex
CREATE UNIQUE INDEX "articles_repoId_slug_key" ON "articles"("repoId", "slug");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repos" ADD CONSTRAINT "repos_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repo_grants" ADD CONSTRAINT "repo_grants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repo_grants" ADD CONSTRAINT "repo_grants_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "repos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_mappings" ADD CONSTRAINT "role_mappings_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "repos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "articles" ADD CONSTRAINT "articles_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "repos"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- The first user of an account is its admin, and the DATABASE decides it.
--
-- `if (userCount === 0) role = AccountAdmin` is a check-then-act: two
-- simultaneous signups both read zero, and a double-clicked button on a slow
-- connection is enough. This index makes the second one lose — it cannot insert
-- a second AccountAdmin for the same account, so `signup` reports the role the
-- store ACTUALLY assigned rather than the one it asked for.
--
-- Written by hand because Prisma's schema language cannot express a PARTIAL
-- unique index. A plain `@@unique([accountId, role])` would be wrong in a way
-- that is easy to miss: it would also permit only one Reader per account.
CREATE UNIQUE INDEX "users_one_account_admin_per_account"
  ON "users" ("accountId")
  WHERE "role" = 'AccountAdmin';
