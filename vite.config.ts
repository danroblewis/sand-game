import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: { target: 'es2022' },
  server: { allowedHosts: ['.trycloudflare.com'] },
  preview: { allowedHosts: ['.trycloudflare.com'] },
  test: { include: ['tests/**/*.test.ts'], testTimeout: 120_000 },
} as any);
