import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";

import {
  HowToArticle,
  HowToNav,
  HowToSearch,
  type Article,
  type ManifestSection,
} from "stonedog-howto";

import { fetchHowTo, type DemoState, type ViewerId } from "./api";
import { ViewerSwitcher } from "./ViewerSwitcher";

function slugFromHash(): string {
  return decodeURIComponent(window.location.hash.replace(/^#\/?/, ""));
}

const hrefFor = (article: Article): string => `#/${article.meta.slug}`;

/** The first article the sidebar offers, depth-first, or null if it offers none. */
function firstInNavOrder(sections: ManifestSection[]): Article | null {
  for (const section of sections) {
    const first = section.articles[0];
    if (first) return first;
    const nested = firstInNavOrder(section.children);
    if (nested) return nested;
  }
  return null;
}

export function App(): ReactElement {
  const [viewer, setViewer] = useState<ViewerId>("admin");
  const [seesUnrestricted, setSeesUnrestricted] = useState(true);
  const [query, setQuery] = useState("");
  const [slug, setSlug] = useState(slugFromHash);
  const [state, setState] = useState<DemoState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onHashChange = (): void => setSlug(slugFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // Every input that changes what this reader may see re-asks the server. The
  // demo never filters in the browser, because a demo that did would be
  // teaching the mistake the package exists to prevent.
  useEffect(() => {
    const controller = new AbortController();
    fetchHowTo({ viewer, seesUnrestricted, query, signal: controller.signal })
      .then((next) => {
        setState(next);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => controller.abort();
  }, [viewer, seesUnrestricted, query]);

  const article = useMemo(() => {
    if (!state) return null;
    // Falls back to the first article in navigation order, rather than to a
    // fixed slug: the fixed one might be an article this reader cannot see, and
    // `bySlug` is an index whose order carries no meaning — landing on whatever
    // it happens to yield first is how a demo opens on "Invoices".
    return state.manifest.bySlug.get(slug) ?? firstInNavOrder(state.manifest.sections) ?? null;
  }, [state, slug]);

  const onSelectViewer = useCallback((next: ViewerId) => {
    setViewer(next);
    setQuery("");
  }, []);

  if (error !== null) {
    return (
      <main className="error">
        <h1>The demo server could not build the how-to</h1>
        <pre>{error}</pre>
        <p>
          A malformed article throws an error naming the file. That is the
          designed behaviour — fix the file named above and this page recovers on
          save.
        </p>
      </main>
    );
  }

  if (state === null) return <main className="loading">Loading…</main>;

  const { payload } = state;
  const hidden = payload.stats.total - payload.stats.visible;

  return (
    <div className="layout">
      <header className="topbar">
        <div className="brand">
          <strong>stonedog-howto</strong>
          <span>demo</span>
        </div>

        <ViewerSwitcher
          current={viewer}
          onSelect={onSelectViewer}
          seesUnrestricted={seesUnrestricted}
          onToggleUnrestricted={setSeesUnrestricted}
        />
      </header>

      <p className="disclosure" role="status">
        Viewing as <strong>{payload.viewer.label}</strong>, holding{" "}
        {payload.viewer.roles.map((role) => (
          <code key={role}>{role}</code>
        ))}
        . The server sent <strong>{payload.stats.visible}</strong> of{" "}
        <strong>{payload.stats.total}</strong> articles
        {hidden > 0 ? ` — the other ${hidden} never left it.` : "."}
      </p>

      <div className="body">
        <aside className="sidebar">
          <HowToSearch
            className="search"
            value={query}
            onChange={setQuery}
            results={state.results ?? []}
            hrefFor={hrefFor}
          />
          <HowToNav
            className="nav"
            manifest={state.manifest}
            hrefFor={hrefFor}
            {...(article ? { activeSlug: article.meta.slug } : {})}
          />
        </aside>

        <main className="content">
          {article ? (
            <>
              {article.meta.roles ? (
                <p className="gate">
                  Gated on{" "}
                  {article.meta.roles.map((role) => (
                    <code key={role}>{role}</code>
                  ))}
                </p>
              ) : (
                <p className="gate open">Declares no roles</p>
              )}
              <HowToArticle article={article} />
            </>
          ) : (
            // Reached when `seesUnrestricted` is off and a viewer holds no role
            // any article names. Says nothing about what exists.
            <p>There are no articles to show.</p>
          )}
        </main>
      </div>
    </div>
  );
}
