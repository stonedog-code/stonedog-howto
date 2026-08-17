import type { ReactElement } from "react";

import type { Manifest, ManifestSection } from "../manifest";
import type { Article } from "../types";

import { controlTapTarget } from "./tapTarget";

export interface HowToNavProps {
  /**
   * The manifest to render.
   *
   * Pass one that has already been through `filterManifest` for this reader.
   * This component renders what it is given — it has no viewer and performs no
   * access check, precisely so that the filtering has to happen on the server,
   * where it cannot be skipped by a client that chooses not to run it.
   */
  manifest: Manifest;
  hrefFor: (article: Article) => string;
  /** Slug of the article currently open, marked as the current page. */
  activeSlug?: string;
  label?: string;
  className?: string;
}

function SectionList({
  section,
  hrefFor,
  activeSlug,
}: {
  section: ManifestSection;
  hrefFor: (article: Article) => string;
  activeSlug: string | undefined;
}): ReactElement {
  return (
    <li data-testid={`howto-nav-section-${section.id}`}>
      <span>{section.title}</span>

      {section.articles.length > 0 ? (
        <ul>
          {section.articles.map((article) => {
            const isActive = article.meta.slug === activeSlug;
            return (
              <li key={article.meta.slug}>
                <a
                  href={hrefFor(article)}
                  // These are the page's navigation and the sole content of
                  // their row, so they are controls, not in-sentence links —
                  // the WCAG 2.5.5 carve-out for prose does not reach them and
                  // they carry the 48px floor (NEH-874).
                  style={controlTapTarget}
                  // `aria-current="page"` rather than a class alone: the styling
                  // says which entry is current to someone who can see it, and
                  // this says it to everyone else.
                  {...(isActive ? { "aria-current": "page" as const } : {})}
                >
                  {article.meta.title}
                </a>
              </li>
            );
          })}
        </ul>
      ) : null}

      {section.children.length > 0 ? (
        <ul>
          {section.children.map((child) => (
            <SectionList
              key={child.id}
              section={child}
              hrefFor={hrefFor}
              activeSlug={activeSlug}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** The navigation tree: every section, and the articles the reader may open. */
export function HowToNav({
  manifest,
  hrefFor,
  activeSlug,
  label = "How-to contents",
  className,
}: HowToNavProps): ReactElement {
  return (
    <nav aria-label={label} className={className} data-testid="howto-nav">
      <ul>
        {manifest.sections.map((section) => (
          <SectionList
            key={section.id}
            section={section}
            hrefFor={hrefFor}
            activeSlug={activeSlug}
          />
        ))}
      </ul>
    </nav>
  );
}
