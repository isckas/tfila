import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // geo-tz reads its timezone-boundary `.geo.dat` files via `fs.openSync` at
  // call time — a dynamic read Next's file tracer can't follow. Keep the
  // package external so its `__dirname`-relative data path resolves to the real
  // node_modules copy, AND explicitly trace the data dir into the `/` route's
  // serverless function so the files actually ship. Without this, `findTz()`
  // throws ENOENT in the Vercel function and 500s the located home feed.
  serverExternalPackages: ["geo-tz"],
  outputFileTracingIncludes: {
    "/": ["node_modules/geo-tz/data/**/*"],
  },
};

export default nextConfig;
