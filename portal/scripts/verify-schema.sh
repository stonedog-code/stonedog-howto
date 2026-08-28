#!/usr/bin/env bash
#
# Apply the migration to a real PostgreSQL and prove the first-admin index
# actually arbitrates.
#
# This exists because the claim it checks cannot be made by a unit test. The
# signup contract says the DATABASE decides which of two simultaneous signups
# becomes the account admin -- and a fake store can model that constraint
# perfectly while the real schema lacks it entirely. The only way to know is to
# run the SQL and race it.
#
# Throwaway container, so it needs no provisioned database and touches nothing
# in AWS. Requires docker.
#
#   bash scripts/verify-schema.sh
#
set -euo pipefail

CONTAINER="howto-schema-verify-$$"
PORT="${PORT:-55492}"
MIGRATION="prisma/migrations/20260808190000_init/migration.sql"

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "starting throwaway postgres…"
docker run -d --name "$CONTAINER" \
  -e POSTGRES_PASSWORD=verify -e POSTGRES_DB=howto \
  -p "$PORT:5432" postgres:16-alpine >/dev/null

for _ in $(seq 1 60); do
  docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done

echo "applying $MIGRATION…"
docker cp "$MIGRATION" "$CONTAINER:/tmp/m.sql" >/dev/null
docker exec "$CONTAINER" psql -U postgres -d howto -v ON_ERROR_STOP=1 -q -f /tmp/m.sql

psql_q() { docker exec "$CONTAINER" psql -U postgres -d howto -q "$@"; }
psql_v() { docker exec "$CONTAINER" psql -U postgres -d howto -tAc "$1"; }

fail() { echo "FAIL: $1" >&2; exit 1; }

psql_q -c "INSERT INTO accounts (id,name) VALUES ('a1','One'),('a2','Two');" >/dev/null
psql_q -c "INSERT INTO users (id,\"accountId\",email,\"passwordHash\",role)
           VALUES ('u1','a1','one@x','h','AccountAdmin');" >/dev/null

# 1. A second admin in the same account must be refused.
if psql_q -c "INSERT INTO users (id,\"accountId\",email,\"passwordHash\",role)
              VALUES ('u2','a1','two@x','h','AccountAdmin');" >/dev/null 2>&1; then
  fail "a second AccountAdmin was accepted for one account"
fi

# 2. Ordinary members must still be unconstrained. This is the case a plain
#    @@unique([accountId, role]) would break -- and it would break it silently,
#    by permitting only one Reader per account.
psql_q -c "INSERT INTO users (id,\"accountId\",email,\"passwordHash\",role)
           VALUES ('u3','a1','three@x','h','Reader'),
                  ('u4','a1','four@x','h','Reader');" >/dev/null \
  || fail "two Readers in one account were refused"

# 3. The constraint is per account, not global.
psql_q -c "INSERT INTO users (id,\"accountId\",email,\"passwordHash\",role)
           VALUES ('u5','a2','five@x','h','AccountAdmin');" >/dev/null \
  || fail "an AccountAdmin was refused in a different account"

# 4. The race itself. Eight concurrent inserts, exactly one survivor -- the
#    check-then-act this index replaces would let several through.
psql_q -c "INSERT INTO accounts (id,name) VALUES ('a3','Race');" >/dev/null
for i in $(seq 1 8); do
  psql_q -c "INSERT INTO users (id,\"accountId\",email,\"passwordHash\",role)
             VALUES ('r$i','a3','r$i@x','h','AccountAdmin');" >/dev/null 2>&1 &
done
wait

winners=$(psql_v "SELECT count(*) FROM users WHERE \"accountId\"='a3' AND role='AccountAdmin';")
[ "$winners" = "1" ] || fail "8 concurrent signups produced $winners admins, expected 1"

echo "schema verified: the first-admin index arbitrates (8 concurrent → 1 admin)"
