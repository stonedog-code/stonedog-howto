/**
 * The demo's three audiences — shared by the server and the browser.
 *
 * Its own module, with no imports, and that is load-bearing: the switcher in the
 * header needs these labels, and importing them from `server/howto.ts` would
 * drag `node:fs` into the browser bundle through the article loader. The
 * package puts its filesystem helpers behind a separate entry point for exactly
 * this reason, and a demo that defeated that would be a poor advertisement.
 */

export const VIEWER_IDS = ["guest", "user", "admin"] as const;
export type ViewerId = (typeof VIEWER_IDS)[number];

export interface DemoViewer {
  id: ViewerId;
  label: string;
  /** The roles this person holds. */
  roles: string[];
  /** One line for the impersonation switcher. */
  blurb: string;
}

/**
 * Roles accumulate rather than replace: an Admin holds `User` and `Guest` too.
 *
 * That is a decision this demo makes, not one the package makes. An article's
 * `roles` is a set-membership test, so a host wanting a hierarchy expresses it
 * by granting the lower roles alongside the higher one — which is honest about
 * what is happening, rather than smuggling an ordering into a list of names
 * that has none.
 */
export const VIEWERS: Record<ViewerId, DemoViewer> = {
  guest: {
    id: "guest",
    label: "Guest",
    roles: ["Guest"],
    blurb: "Signed out. Public articles only.",
  },
  user: {
    id: "user",
    label: "User",
    roles: ["Guest", "User"],
    blurb: "Signed in. Everything but administration.",
  },
  admin: {
    id: "admin",
    label: "Admin",
    roles: ["Guest", "User", "Admin"],
    blurb: "Sees every article, including billing.",
  },
};

export function isViewerId(value: unknown): value is ViewerId {
  return typeof value === "string" && (VIEWER_IDS as readonly string[]).includes(value);
}
