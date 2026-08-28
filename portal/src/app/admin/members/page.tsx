import { redirect } from "next/navigation";

import { ASSIGNABLE_ACCOUNT_ROLES } from "../../../lib/capabilities";
import { prisma } from "../../../lib/db/client";
import { userCan } from "../../../lib/rbac";
import { currentUser } from "../../../lib/session/session";
import { saveGrantsAction } from "./actions";

/**
 * Who may read which repository.
 *
 * The other half of the access model. `/admin/mapping` decides which of a
 * repository's own role names a portal role may read; this decides who holds a
 * portal role there at all — and until it existed, nothing in the application
 * wrote a `RepoGrant` at all. The grants that governed everything could only be
 * created by an integration test or by hand in psql, so a second person could
 * sign up, be given any role, and see nothing, permanently.
 *
 * A checkbox per (repository × portal role) per person, mirroring the mapping
 * screen on purpose: the two are read together and an admin should not have to
 * learn two shapes.
 */
export default async function MembersPage() {
  const user = await currentUser();
  if (user === null) redirect("/login");

  // `member:manage` is held account-wide by an account administrator, so this
  // is a global check rather than a per-repository one. Before the account role
  // granted anything, nobody but the deployment operator would have passed it.
  if (!userCan(user, "member:manage")) redirect("/repos");

  const me = await prisma.user.findUnique({
    where: { id: user.id },
    select: { accountId: true },
  });
  if (me === null) redirect("/login");

  const [members, repos] = await Promise.all([
    prisma.user.findMany({
      where: { accountId: me.accountId },
      orderBy: { email: "asc" },
      select: {
        id: true,
        email: true,
        role: true,
        grants: { select: { repoId: true, role: true } },
      },
    }),
    prisma.repo.findMany({
      where: { accountId: me.accountId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, status: true },
    }),
  ]);

  return (
    <main style={{ maxWidth: "56rem", margin: "3rem auto", fontFamily: "system-ui" }}>
      <h1>Members</h1>
      <p>
        Which repositories each person may read, and as which portal role.{" "}
        <strong>Anything unticked is denied</strong> — somebody with no grant at
        all sees nothing, which is the safe state rather than an error.
      </p>
      <p>
        What they see <em>inside</em> a repository is decided separately, by its{" "}
        <a href="/admin/mapping">role mapping</a>.
      </p>

      {repos.length === 0 ? (
        <p>
          This account has no repositories yet, so there is nothing to grant.
          They arrive from <code>articles.json</code> and are adopted on the{" "}
          <a href="/admin/mapping">role mapping</a> screen.
        </p>
      ) : (
        members.map((member) => {
          const held = new Set(member.grants.map((grant) => `${grant.repoId} ${grant.role}`));

          return (
            <section key={member.id} style={{ marginBottom: "3rem" }}>
              <h2>
                {member.email}{" "}
                <small style={{ fontWeight: "normal", color: "#555" }}>
                  {member.role}
                  {member.role === "SystemAdmin"
                    ? " — reads everything; grants do not apply"
                    : member.role === "AccountAdmin"
                      ? " — administers this account, so holds its repositories already"
                      : ""}
                </small>
              </h2>

              {member.role === "SystemAdmin" || member.role === "AccountAdmin" ? (
                // Said rather than left to be inferred from an empty row. An
                // administrator's reach comes from their account role, so
                // ticking a box here would change nothing and its being
                // unticked does not mean they are shut out — which is exactly
                // what an admin reading this screen would otherwise conclude.
                <p role="note" style={{ color: "#555" }}>
                  Their access comes from their account role, not from these
                  grants. Adding one here is possible and changes nothing.
                </p>
              ) : null}

              <form action={saveGrantsAction}>
                <input type="hidden" name="userId" value={member.id} />
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Repository</th>
                      {ASSIGNABLE_ACCOUNT_ROLES.map((role) => (
                        <th key={role} scope="col">
                          {role}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {repos.map((repo) => (
                      <tr key={repo.id}>
                        <th scope="row">
                          {repo.name}
                          {repo.status === "Active" ? null : (
                            <small style={{ fontWeight: "normal", color: "#8a1c1c" }}>
                              {" "}
                              ({repo.status})
                            </small>
                          )}
                        </th>
                        {ASSIGNABLE_ACCOUNT_ROLES.map((role) => (
                          <td key={role}>
                            <input
                              type="checkbox"
                              name={`grant:${repo.id}`}
                              value={role}
                              defaultChecked={held.has(`${repo.id} ${role}`)}
                              aria-label={`${member.email} holds ${role} in ${repo.name}`}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button type="submit">Save {member.email}</button>
              </form>
            </section>
          );
        })
      )}
    </main>
  );
}
