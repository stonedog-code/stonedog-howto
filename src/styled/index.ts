/**
 * The `stonedog-style` presentation layer (`@stonedogcode/howto/styled`).
 *
 * A separate entry point on purpose. The core package has no styling
 * dependency, and importing this module is what opts a consumer into Panda CSS
 * and the design system. A host with its own components never loads it and
 * never installs `stonedog-style`.
 *
 * Consumers of this entry point must, in their own `panda.config.ts`:
 *   - add `stonedogStylePreset()` to `presets`, alongside `@pandacss/preset-base`
 *     and `@pandacss/preset-panda` (a `presets` array REPLACES the defaults);
 *   - add BOTH `./node_modules/@stonedogcode/howto/src/**` and
 *     `../../node_modules/@stonedogcode/howto/src/**` to `include`, plus the same
 *     pair for `stonedog-style`. npm workspaces hoist, so which path exists
 *     depends on the tree, and a glob that matches nothing fails silently —
 *     the components render with class names that have no CSS behind them.
 */

export { stonedogArticleComponents } from "./articleComponents.js";
