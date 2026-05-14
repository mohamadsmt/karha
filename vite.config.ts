/// <reference types="vitest" />

import react from '@vitejs/plugin-react';
import type { UserConfig } from 'vite';

type KarhaViteConfig = UserConfig & { test: Record<string, unknown> };

export default {
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:3737'
    }
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    globals: true,
    pool: 'forks',
    server: {
      deps: {
        external: ['node:sqlite']
      }
    },
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx']
  }
} satisfies KarhaViteConfig;
