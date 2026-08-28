/** @type {import('next').NextConfig} */
const nextConfig = {
  // All THREE stonedog packages ship TypeScript source rather than a bundle.
  // For @stonedogcode/howto the reason is Panda, which extracts styles by
  // statically parsing source at the CONSUMER's build; the other two simply
  // follow the house convention.
  //
  // Listing only `howto` is the easy mistake and the error does not point at
  // this line: webpack reports "Module parse failed: Unexpected token" inside
  // node_modules, at whichever `type` import it reached first, which reads as a
  // broken dependency rather than a missing entry here.
  transpilePackages: [
    "@stonedogcode/howto",
    "@stonedogcode/auth",
    "@stonedogcode/rbac",
  ],

  // The version and sha a page renders. Read at BUILD time, so they must reach
  // the builder stage of the image -- a value injected into the running
  // container arrives after the prerendered page that displays it was written.
  env: {
    APP_VERSION: process.env.APP_VERSION ?? "dev",
    GIT_SHA: process.env.GIT_SHA ?? "dev",
  },

  // The portal serves internal documentation from three products. It should
  // never be framed, sniffed, or have its URLs leak to another origin.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
};

export default nextConfig;
