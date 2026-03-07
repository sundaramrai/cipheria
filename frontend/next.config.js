/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Reduce production bundle size — skip inline source maps
  productionBrowserSourceMaps: false,

  // Tree-shake known icon/UI packages at build time to reduce bundle and compile overhead
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },

  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.API_URL || 'http://localhost:8000'}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
