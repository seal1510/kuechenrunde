import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'server/**/*.test.ts', 'functions/**/*.test.ts'],
    setupFiles: ['./src/test/setup.ts'],
  },
})
