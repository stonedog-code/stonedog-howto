"use client";

import { useActionState } from "react";

import { signUpAction, type FormState } from "../actions";

export default function SignupPage() {
  const [state, action, pending] = useActionState<FormState, FormData>(signUpAction, {});

  return (
    <main style={{ maxWidth: "24rem", margin: "4rem auto", fontFamily: "system-ui" }}>
      <h1>Create an account</h1>
      <form action={action}>
        <label style={{ display: "block", marginBottom: "0.75rem" }}>
          Account
          <input name="accountId" required
            style={{ display: "block", width: "100%" }} />
        </label>
        <label style={{ display: "block", marginBottom: "0.75rem" }}>
          Email
          <input name="email" type="email" required autoComplete="username"
            style={{ display: "block", width: "100%" }} />
        </label>
        <label style={{ display: "block", marginBottom: "0.75rem" }}>
          Password
          <input name="password" type="password" required autoComplete="new-password"
            style={{ display: "block", width: "100%" }} />
        </label>
        <button type="submit" disabled={pending}>{pending ? "Creating…" : "Create account"}</button>
      </form>

      {/* A weak password is named, because the person chose it and can fix it.
          Everything else is one flat message. */}
      {state.error ? <p role="alert">{state.error}</p> : null}

      <p><a href="/login">Sign in instead</a></p>
    </main>
  );
}
