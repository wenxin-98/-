// tsup.config.ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  clean: true,
  sourcemap: true,
  splitting: false,
  // 不 bundle 依赖，用 node_modules
  noExternal: [],
  external: [
    'better-sqlite3',
    'express',
    'cors',
    'helmet',
    'compression',
    'axios',
    'jsonwebtoken',
    'bcryptjs',
    'drizzle-orm',
    'winston',
    'zod',
    'cron',
    'nanoid',
    'dotenv',
    'ws',
  ],
});
