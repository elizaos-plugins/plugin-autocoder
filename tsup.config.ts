import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'dist',
  tsconfig: './tsconfig.build.json', // Use build-specific tsconfig
  sourcemap: true,
  clean: true,
  format: ['esm'], // Ensure you're targeting CommonJS
  dts: true, // require DTS so we get d.ts in the dist folder on npm
  external: [
    'typescript',
    'execa',
    'dotenv', // Externalize dotenv to prevent bundling
    'fs', // Externalize fs to use Node.js built-in module
    'fs-extra', // Externalize fs-extra to prevent bundling issues
    'path', // Externalize other built-ins if necessary
    'https',
    'http',
    'child_process',
    'stream',
    'util',
    'os',
    'url',
    '@elizaos/core',
    'zod',
    'punycode',
    'node-fetch',
    'http',
    'agentkeepalive',
    'chromium-bidi',
  ],
});
