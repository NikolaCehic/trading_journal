import { defineConfig } from 'vitest/config'
import tsConfigPaths from 'vite-tsconfig-paths'
import { loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [tsConfigPaths()],
    test: {
      environment: 'node',
      include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx', 'src/**/*.test.ts', 'src/**/*.test.tsx'],
      environmentMatchGlobs: [
        ['tests/unit/components/**/*.test.tsx', 'jsdom'],
        ['tests/unit/components/**/*.tsx', 'jsdom'],
      ],
      setupFiles: ['tests/setup.ts'],
      env: {
        ...env,
        NODE_ENV: 'test',
      },
    },
  }
})
