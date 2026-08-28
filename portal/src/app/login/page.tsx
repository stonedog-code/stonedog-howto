"use client";

import { useActionState } from "react";

import { logInAction, type FormState } from "../actions";

export default function LoginPage() {
  const [state, action, pending] = useActionState<FormState, FormData>(logInAction, {});

  return (
    <main style={{ maxWidth: "24rem", margin: "4rem auto", fontFamily: "system-ui" }}>
      <h1>Sign in</h1>
      <form action={action}>
        <label style={{ display: "block", marginBottom: "0.75rem" }}>
          Email
          <input name="email" type="email" required autoComplete="username"
            style={{ display: "block", width: "100%" }} />
        </label>
        <label style={{ display: "block", marginBottom: "0.75rem" }}>
          Password
          <input name="password" type="password" required autoComplete="current-password"
            style={{ display: "block", width: "100%" }} />
        </label>
        <button type="submit" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
      </form>

      {/* One message for every failure. Naming which half was wrong turns this
          form into an account enumerator. */}
      {state.error ? <p role="alert">{state.error}</p> : null}

      <p><a href="/signup">Create an account</a></p>
    </main>
  );
}
