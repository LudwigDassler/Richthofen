/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  productionBrowserSourceMaps: false,
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    cpus: 1,
    workerThreads: false,
  },
  webpack: (config, { dev, isServer }) => {
    if (dev && !isServer) {
      config.devtool = false;
      config.output = {
        ...config.output,
        chunkLoadTimeout: 300000,
      };
    }
    return config;
  },
};

export default nextConfig;
