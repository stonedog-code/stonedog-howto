"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { passwords } from "../lib/auth/passwords";
import { prisma } from "../lib/db/client";
import { prismaSignupStore } from "../lib/db/signupStore";
import { signup } from "../lib/signup";
import { SESSION_COOKIE, serialiseSession } from "../lib/session/session";

export interface FormState {
  error?: string;
}

/**
 * The one place a session cookie is minted.
 *
 * `httpOnly` so script cannot read it, `sameSite: lax` so it does not ride
 * along on a cross-site request, and `secure` only outside development —
 * the portal runs on plain http://localhost and a `secure` cookie would simply
 * never be stored, which presents as "login silently does nothing".
 */
async function startSession(userId: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, serialiseSession(userId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
}

export async function signUpAction(_prev: FormState, form: FormData): Promise<FormState> {
  const accountId = String(form.get("accountId") ?? "").trim();
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");

  if (accountId === "" || email === "" || password === "") {
    return { error: "Every field is required." };
  }

  const result = await signup(
    { accountId, email, password },
    { store: prismaSignupStore(prisma), passwords },
  );

  if (!result.ok) {
    // A weak password is the user's own choice and safe to name. Everything
    // else -- a taken email, an unknown account -- returns one message, because
    // distinguishing them answers "does this person have an account here" for
    // anyone who asks.
    return {
      error:
        result.reason === "weak-password"
          ? result.message
          : "That signup could not be completed.",
    };
  }

  await startSession(result.user.id);
  redirect("/repos");
}

export async function logInAction(_prev: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");

  const user = await prisma.user.findFirst({
    where: { email },
    select: { id: true, passwordHash: true },
  });

  // Verify even when no user matched, against a hash that cannot succeed.
  //
  // The package returns `{ ok: false }` immediately for an absent hash, which
  // is correct for it and a timing oracle for us: a missing user would answer
  // in a millisecond while a wrong password takes argon2's full cost, and the
  // difference answers "is this address registered" to anyone with a stopwatch.
  // So an unknown email is made to pay the same price.
  const candidate =
    user?.passwordHash ?? "$argon2id$v=19$m=19456,t=2,p=1$bm90YXJlYWxzYWx0$bm90YXJlYWxoYXNo";
  const result = await passwords.verify(candidate, password);

  if (!result.ok || user === null) return { error: "Those details did not match." };

  await startSession(user.id);
  redirect("/repos");
}

export async function logOutAction(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect("/login");
}
