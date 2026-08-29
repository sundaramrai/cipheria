const apiOrigin =
  process.env.INTERNAL_API_ORIGIN?.trim() ||
  process.env.NEXT_PUBLIC_API_URL?.trim();
const shouldProxyApi = Boolean(apiOrigin);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Vercel's Next.js adapter packages the deployment itself. Enabling
  // standalone output there makes Next 16.3 look for a trace file that the
  // adapter intentionally does not emit. Docker builds still need it.
  ...(process.env.VERCEL ? {} : { output: 'standalone' }),

  // Reduce production bundle size - skip inline source maps
  productionBrowserSourceMaps: false,

  // Tree-shake known icon/UI packages at build time to reduce bundle and compile overhead
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },

  async rewrites() {
    if (!shouldProxyApi) return [];

    return [
      {
        source: '/api/:path*',
        destination: `${apiOrigin}/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
