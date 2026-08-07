import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin, type ViteDevServer } from "vite";

import { isViewerId } from "./shared/viewers";

const here = dirname(fileURLToPath(import.meta.url));
const packageSrc = resolve(here, "..", "src");

/**
 * The demo's whole backend: one endpoint that answers with the how-to as one
 * viewer may see it.
 *
 * A Vite middleware rather than a separate server process, so `npm run dev` is
 * genuinely one command with nothing to start alongside it. The important part
 * is not the plumbing but *which side of the wire* the work happens on: this
 * runs in Node, and the browser receives an already-filtered result.
 */
function howToApi(): Plugin {
  return {
    name: "demo-howto-api",
    configureServer(server: ViteDevServer) {
      server.middlewares.use("/api/howto", (req, res) => {
        // Imported through Vite's module runner rather than a bare `import`, so
        // editing the demo's server code — or an article — is picked up on the
        // next request instead of needing a restart.
        void server
          .ssrLoadModule("/server/howto.ts")
          .then((module) => {
            const { buildPayload } = module as typeof import("./server/howto");

            const url = new URL(req.url ?? "/", "http://localhost");
            const requested = url.searchParams.get("viewer");

            // An unknown viewer falls back to the least privileged one. The
            // demo lets you choose your own audience, which no real application
            // should; falling *down* on bad input at least keeps the failure
            // mode in the safe direction.
            const viewerId = isViewerId(requested) ? requested : "guest";

            const payload = buildPayload({
              viewerId,
              seesUnrestricted: url.searchParams.get("unrestricted") !== "0",
              query: url.searchParams.get("q") ?? "",
            });

            res.setHeader("content-type", "application/json; charset=utf-8");
            res.end(JSON.stringify(payload));
          })
          .catch((error: unknown) => {
            // A malformed article throws here, naming the file. Surfaced as-is
            // because that is the behaviour being demonstrated — and because
            // this is a local demo server, not a product surface where an
            // internal path in an error response would be a leak.
            res.statusCode = 500;
            res.setHeader("content-type", "application/json; charset=utf-8");
            res.end(
              JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
            );
          });
      });

      // Watch the articles so editing one reloads the page. Vite watches source
      // by default; markdown that is read at request time is invisible to it.
      server.watcher.add(resolve(here, "content"));
      server.watcher.on("change", (path) => {
        if (path.endsWith(".md")) server.ws.send({ type: "full-reload" });
      });
    },
  };
}

export default defineConfig({
  root: here,
  plugins: [react(), howToApi()],
  resolve: {
    /**
     * Point the package specifiers at this repository's own `src`, so the demo
     * exercises the working tree rather than a published tarball. Editing
     * `src/access.ts` changes what the demo does on the next reload.
     *
     * An alias rather than a workspace dependency, deliberately.
     * `stonedog-howto` is a real, published package: declaring it as a
     * dependency of the demo invites npm to install 0.1.1 from the registry,
     * and the demo would then quietly demonstrate the last release instead of
     * the branch under review — with everything still building.
     *
     * The exact-match `find` entries are needed because `stonedog-howto`
     * is a prefix of `stonedog-howto/node`; a plain string alias would
     * rewrite the subpath imports into the wrong file.
     */
    alias: [
      { find: /^stonedog-howto$/, replacement: resolve(packageSrc, "index.ts") },
      { find: /^stonedog-howto\/node$/, replacement: resolve(packageSrc, "node/index.ts") },
      { find: /^stonedog-howto\/styled$/, replacement: resolve(packageSrc, "styled/index.ts") },
    ],
  },
  server: { port: 5174 },
});
