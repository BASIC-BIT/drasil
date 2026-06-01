import path from 'node:path';
import { fileURLToPath } from 'node:url';

const configDir = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.resolve(configDir, '..', '..'),
  transpilePackages: ['@drasil/contracts'],
  experimental: {
    externalDir: true,
  },
  turbopack: {
    root: path.resolve(configDir, '..', '..'),
  },
};

export default nextConfig;
