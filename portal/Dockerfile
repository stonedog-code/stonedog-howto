# The portal, as a container.
#
# node:24-alpine, matching optima-cloud-saas — and that choice is why
# @node-rs/argon2 is the Argon2 binding here rather than the node-gyp one:
# Alpine carries no build toolchain, and @node-rs/argon2 publishes a prebuilt
# linux-x64-musl binary that `npm ci` resolves instead of compiling.
#
# ─────────────────────────────────────────────────────────────────────────────
# THIS BUILDS, and the image it produces is running.
#
# This block carried a long "THIS DOES NOT BUILD YET" warning through the two
# commits that made it false. It was accurate when written — there was no
# application, `npm run build` named a script package.json did not have — and it
# outlived its cause, which is the failure mode this repository keeps finding in
# its own comments. Both stages complete; `docker run` serves on :3000; and
# /api/health reports the version and sha baked in below.
#
# Nothing in the file changed to make that true. It was written ahead of the app
# on purpose, and the two decisions it exists to record are unchanged: the
# argon2 binding, and APP_VERSION reaching the BUILDER stage.
#
# The rule that shaped it is worth keeping, because it is what stopped the
# intermediate state being papered over: stubbing a `build` script to make the
# build go green would have produced an image that starts, serves nothing, and
# reports healthy — a worse lie than a build that fails honestly.
# ─────────────────────────────────────────────────────────────────────────────

FROM node:24-alpine AS deps
WORKDIR /app

# Manifests only, so a source edit does not invalidate the dependency layer.
COPY package.json package-lock.json ./

# `npm ci` rather than `npm install`: it installs exactly the lockfile and fails
# when the two have drifted, which is the check an image build most needs — a
# container that silently resolved different versions than CI tested is a
# container nobody can reason about.
RUN npm ci --omit=dev


FROM node:24-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# BEFORE the gate, not as part of `npm run build` further down.
#
# The Prisma client is generated, and without it every Prisma type degrades to
# `any` or `unknown` — so `type-check` fails with a dozen errors that read as
# application bugs (`Property 'PrismaClientKnownRequestError' does not exist`,
# `Parameter 'repo' implicitly has an 'any' type`) and name no missing step.
#
# `npm run build` does run `prisma generate`, but it runs AFTER this gate, which
# is too late to be the thing that makes the gate pass.
#
# This was invisible until `.dockerignore` landed: the host's node_modules was
# being copied in, generated client and all, so the build worked on any machine
# that had run `npm ci` and failed on a clean clone.
RUN npx prisma generate

# The gate runs INSIDE the image build, not only in CI. The two can disagree —
# a different Node minor, a different platform binary for argon2 — and the
# image is the artefact that serves traffic.
RUN npm run type-check && npm test

# APP_VERSION must reach the BUILDER stage, not only the runtime one. Anything
# a prerendered page reads is evaluated during the build and frozen into static
# HTML, so a value injected into the running container arrives after the page
# that displays it has already been written. optima-cloud-saas shipped a footer
# reading `unknown` for exactly this reason while /api/health was correct.
ARG APP_VERSION=unknown
ARG GIT_SHA=unknown
ENV APP_VERSION=$APP_VERSION
ENV GIT_SHA=$GIT_SHA

RUN npm run build


FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# A non-root user. The portal holds credentials and an access model; a
# container process running as root is one container escape away from the host,
# and there is no reason for it here.
RUN addgroup -g 1001 -S nodejs && adduser -S portal -u 1001

COPY --from=deps    /app/node_modules ./node_modules

# The Prisma client is GENERATED, not installed.
#
# `deps` ran `npm ci` without ever seeing prisma/schema.prisma, so its
# node_modules holds the @prisma/client package with no client inside it. That
# does not fail the build -- it fails at RUNTIME, on the first query, with
# "@prisma/client did not initialize yet". The image starts, reports itself
# ready, serves every page that touches no data, and 500s on the ones that do.
#
# So the generated artefact is copied from the builder, where `npm run build`
# (which runs `prisma generate` first) produced it.
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/.next        ./.next
COPY --from=builder /app/public       ./public
COPY --from=builder /app/package.json ./package.json

ARG APP_VERSION=unknown
ARG GIT_SHA=unknown
ENV APP_VERSION=$APP_VERSION
ENV GIT_SHA=$GIT_SHA

USER portal
EXPOSE 3000

# No secret is baked in. Everything sensitive — DATABASE_URL, the session
# secret, the sync tokens — arrives from Secrets Manager at deploy time, per
# the house pattern. A build arg is recoverable from `docker history`, so a
# credential must never be one; the two above are a version string and a sha.
CMD ["npm", "run", "start"]
