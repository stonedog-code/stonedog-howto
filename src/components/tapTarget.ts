import type { CSSProperties } from "react";

/**
 * The tap-target floor these components guarantee.
 *
 * 48×48 CSS pixels — the house standard, which is stricter than WCAG 2.5.5's
 * 44×44. A control smaller than this is hard to hit accurately with a thumb, and
 * "hard to hit accurately" on a navigation link means opening the wrong article.
 */
export const TAP_TARGET_FLOOR_PX = 48;

/**
 * A control's box: at least the floor in both directions, contents centred.
 *
 * ## Why an inline `style` and not a class, in a package that ships no CSS
 *
 * Two reasons, and both are about what happens in the CONSUMER's build.
 *
 * The core components are deliberately style-agnostic — they render semantic
 * markup and the host dresses it. Reaching for `@stonedogcode/style` here would
 * make an optional peer dependency mandatory for everyone, including hosts that
 * import this package precisely because it has no opinion about colour.
 *
 * And a Panda class would be worse than useless: Panda extracts styles by
 * statically parsing source at the consumer's build, so a class name emitted
 * here only has CSS behind it if that consumer's `include` globs happen to
 * reach into `node_modules/@stonedogcode/howto/src/**`. A glob that matches
 * nothing fails **silently** — the class lands in the DOM with no rule behind
 * it, and the control is 22 px again with nothing to show for it. An inline
 * style cannot miss.
 *
 * ## Why `display: flex` rather than `inline-flex`
 *
 * `min-height` does nothing at all to an inline box, so some non-inline display
 * has to be set; that much is forced. Between the two, `flex` fills the row it
 * is in, which is what every one of these controls is — a row in a vertical
 * list — and a full-width row is a strictly larger target than a shrink-wrapped
 * one. It also preserves the `display: block` a host has almost certainly
 * already written for a sidebar link.
 *
 * A horizontal navigation still works: when the parent is a flex or grid
 * container these anchors are flex items, and a flex item's display is
 * blockified regardless, so `flex` and `inline-flex` lay out identically there.
 *
 * ## Why this is a floor and not a size
 *
 * `min-height`/`min-width` only ever push a box up. A host adding padding, a
 * larger font, or a taller row gets exactly what it asked for; a host that
 * styles these links to 22 px gets 48.
 */
export const controlTapTarget: CSSProperties = {
  display: "flex",
  alignItems: "center",
  minHeight: `${TAP_TARGET_FLOOR_PX}px`,
  minWidth: `${TAP_TARGET_FLOOR_PX}px`,
};

/**
 * The same floor for a form control that already lays itself out.
 *
 * A text input is replaced-ish content with its own internal box; giving it
 * `display: flex` would fight the browser for no benefit. It only needs the
 * height it is short of.
 */
export const inputTapTarget: CSSProperties = {
  minHeight: `${TAP_TARGET_FLOOR_PX}px`,
};
