import { redirect } from "next/navigation";

import { currentUser } from "../lib/session/session";

/**
 * The front door. Signed in or not, nothing is rendered here — the decision is
 * made on the server before any markup exists, so an unauthenticated visitor
 * never receives a page they then get redirected away from.
 */
export default async function HomePage() {
  const user = await currentUser();
  redirect(user === null ? "/login" : "/repos");
}
