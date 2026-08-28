/**
 * The portal's password factor.
 *
 * `@stonedogcode/howto`'s sibling package owns hashing and policy; this file
 * only chooses the binding. `@node-rs/argon2` rather than the node-gyp one
 * because the image is Alpine, which carries no build toolchain — the prebuilt
 * linux-x64-musl binary is what `npm ci` resolves instead of compiling.
 */

import { hash, verify } from "@node-rs/argon2";
import { createPasswordFactor, type PasswordFactor } from "@stonedogcode/auth";
// A separate entry point on purpose: importing the binding is what opts you
// into it, so a consumer using the native one never loads this.
import { nodeRsArgon2 } from "@stonedogcode/auth/argon2-node-rs";

// Constructed once at module scope. `createPasswordFactor` throws on a missing
// binding at CONSTRUCTION rather than at first sign-in, which is what turns a
// packaging mistake into a process that will not start instead of an
// authentication outage discovered by a user.
export const passwords: PasswordFactor = createPasswordFactor({
  argon2: nodeRsArgon2({ hash, verify }),
});
