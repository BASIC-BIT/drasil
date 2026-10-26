import process from 'node:process';
import path from 'node:path';
import { legacyTestAliases } from './e2e/legacy/build-aliases.mjs';
import { fileURLToPath } from 'node:url';

const configDir = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  distDir: process.env.DRASIL_LEGACY_TEST_BUILD === 'true' ? '.next-legacy-test' : '.next',
  webpack(config, { webpack }) {
    if (process.env.DRASIL_LEGACY_TEST_BUILD === 'true')
      config.plugins.push(legacyTestAliases(configDir, webpack));
    return config;
  },
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
