import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['pdf-parse'],
  outputFileTracingRoot: __dirname,
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
