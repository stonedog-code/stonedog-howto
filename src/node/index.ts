/**
 * Filesystem helpers (`@stonedogcode/howto/node`).
 *
 * A separate entry point so a browser bundle never pulls `node:fs` in through
 * the package's main export.
 */
export { loadArticles, type LoadArticlesOptions } from "./loadArticles";
