/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['xlsx', 'pdf-parse'],
  },
  webpack: (config, { dev }) => {
    if (dev) {
      // В dev-режиме используем кеш в памяти вместо файлового —
      // это исключает ошибку "Cannot find module './NNN.js'" после изменений кода
      config.cache = { type: 'memory' };
    }
    return config;
  },
};

export default nextConfig;
