import { redirect } from "next/navigation";

import { ASSIGNABLE_ACCOUNT_ROLES } from "../../../lib/capabilities";
import { prisma } from "../../../lib/db/client";
import { userCan } from "../../../lib/rbac";
import { currentUser } from "../../../lib/session/session";
import { saveMappingAction } from "./actions";

/**
 * The screen the access model exists for.
 *
 * Each repository, the source role names its own articles actually use, and a
 * checkbox per (portal role × source role). Unchecked means denied — there is
 * no third state, because "not decided" and "denied" must be the same thing
 * for the safe default to hold.
 */
export default async function MappingPage() {
  const user = await currentUser();
  if (user === null) redirect("/login");

  const repos = await prisma.repo.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      status: true,
      path: true,
      mappings: true,
      articles: { select: { sourceRoles: true, missingRoles: true } },
    },
  });

  // Only the repositories this person may configure. An admin of one product's
  // documentation is not an admin of another's.
  const manageable = repos.filter((repo) => userCan(user, "mapping:manage", repo.id));

  return (
    <main style={{ maxWidth: "56rem", margin: "3rem auto", fontFamily: "system-ui" }}>
      <h1>Role mapping</h1>
      <p>
        Which of a repository&rsquo;s <em>own</em> role names each portal role may
        read. <strong>Anything unchecked is denied</strong> — a source role nobody
        maps is a source role nobody can read.
      </p>

      {manageable.length === 0 ? (
        <p>There are no repositories you can configure.</p>
      ) : (
        manageable.map((repo) => {
          // The role names its articles ACTUALLY use, gathered from the synced
          // content rather than typed by hand. A mapping screen offering names
          // nobody wrote invites a mapping that grants nothing, which then
          // looks like a bug in the access model.
          const sourceRoles = [
            ...new Set(repo.articles.flatMap((article) => article.sourceRoles)),
          ].sort();
          const unclassified = repo.articles.filter((a) => a.missingRoles).length;

          return (
            <section key={repo.id} style={{ marginBottom: "3rem" }}>
              <h2>
                {repo.name}{" "}
                <small style={{ fontWeight: "normal", color: "#555" }}>
                  {repo.status}
                  {repo.mappings.length === 0 ? " — nothing mapped, so nothing syncs" : ""}
                </small>
              </h2>

              {unclassified > 0 ? (
                <p role="alert" style={{ color: "#8a1c1c" }}>
                  <strong>{unclassified}</strong> article(s) here declare no roles.
                  They reach system administrators alone until someone adds an
                  audience at source.
                </p>
              ) : null}

              {sourceRoles.length === 0 ? (
                // The FIRST mapping, and the case that deadlocked the portal.
                //
                // This branch used to render this sentence INSTEAD of the form,
                // which is unarguable and was fatal: an unconfigured repository
                // syncs nothing, so it has no articles, so it offers no source
                // roles, so there was no form, so no mapping could be saved, so
                // it stayed unconfigured. A repository could never be onboarded
                // and the portal served nothing for as long as it existed.
                //
                // The form is rendered anyway. Two of its three controls do not
                // depend on observed roles, and "All roles" is exactly what
                // adopting a repository means: an admin says a portal role may
                // read everything this repository declares, whatever it turns
                // out to declare. Absence still denies — the admin makes a
                // deliberate grant, nothing is inferred from silence.
                //
                // Said out loud rather than left to be inferred, because a form
                // missing its main columns reads as broken.
                <p>
                  <strong>Nothing has been synced from this repository yet</strong>,
                  so its own role names are not known and the per-role columns
                  below are empty. Grant a portal role <em>All roles</em> to adopt
                  it: the next sync then takes its articles, and the columns
                  appear here for you to narrow.
                </p>
              ) : null}

              <form action={saveMappingAction}>
                <input type="hidden" name="repoId" value={repo.id} />
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Portal role</th>
                      {sourceRoles.map((role) => (
                        <th key={role} scope="col">{role}</th>
                      ))}
                      <th scope="col">All roles</th>
                      <th scope="col">Articles with none</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ASSIGNABLE_ACCOUNT_ROLES.map((portalRole) => {
                      const row = repo.mappings.find((m) => m.role === portalRole);
                      return (
                        <tr key={portalRole}>
                          <th scope="row">{portalRole}</th>
                          {sourceRoles.map((sourceRole) => (
                            <td key={sourceRole}>
                              <input
                                type="checkbox"
                                name={`grant:${portalRole}`}
                                value={sourceRole}
                                defaultChecked={row?.sourceRoles.includes(sourceRole) ?? false}
                                aria-label={`${portalRole} may read ${sourceRole}`}
                              />
                            </td>
                          ))}
                          <td>
                            <input
                              type="checkbox"
                              name={`all:${portalRole}`}
                              defaultChecked={row?.allSourceRoles ?? false}
                              aria-label={`${portalRole} may read every source role`}
                            />
                          </td>
                          <td>
                            <input
                              type="checkbox"
                              name={`unclassified:${portalRole}`}
                              defaultChecked={row?.seesUnclassified ?? false}
                              aria-label={`${portalRole} may read articles declaring no roles`}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <button type="submit">Save {repo.name}</button>
              </form>
            </section>
          );
        })
      )}
    </main>
  );
}
