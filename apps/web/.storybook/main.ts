import type { StorybookConfig } from '@storybook/react-vite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const navigationMock = resolve(appRoot, '.storybook/next-navigation.mock.ts');

const config: StorybookConfig = {
  stories: ['../components/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-a11y'],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  async viteFinal(config) {
    const existingAlias = config.resolve?.alias;

    config.optimizeDeps = {
      ...config.optimizeDeps,
      include: [...(config.optimizeDeps?.include ?? []), 'react', 'react-dom', 'react/jsx-runtime'],
    };
    config.resolve = {
      ...config.resolve,
      alias: Array.isArray(existingAlias)
        ? [
            { find: 'next/navigation', replacement: navigationMock },
            { find: '@', replacement: appRoot },
            ...existingAlias,
          ]
        : { ...existingAlias, 'next/navigation': navigationMock, '@': appRoot },
      dedupe: [...(config.resolve?.dedupe ?? []), 'react', 'react-dom'],
    };

    return config;
  },
};

export default config;
