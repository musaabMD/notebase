/** @type {import('next').NextConfig} */
const nextConfig = {
  /** Hides the dev overlay / `<nextjs-portal>` (N badge, issue panel) in `next dev`. Production is unchanged. */
  devIndicators: false,

  /**
   * Dev-only: default Next 16 logs every incoming request on its own line (verbose timings).
   * Ignoring icon + web manifest cuts most of the per-refresh noise; set `incomingRequests: false`
   * to silence all request logs, or remove this block to log everything again.
   */
  logging: {
    incomingRequests: {
      ignore: [/^\/icon/, /^\/manifest\.webmanifest$/],
    },
  },
};

export default nextConfig;
