/** @type {import('next').NextConfig} */
const apiProxyTarget = process.env.API_PROXY_TARGET?.trim();
const nextConfig = {
  reactStrictMode: true,

  // Reduce production bundle size — skip inline source maps
  productionBrowserSourceMaps: false,

  // Tree-shake known icon/UI packages at build time to reduce bundle and compile overhead
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },

  async rewrites() {
    if (!apiProxyTarget) return [];
    return [
      {
        source: '/api/:path*',
        destination: `${apiProxyTarget.replace(/\/+$/, '')}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
