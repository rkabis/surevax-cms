import path from 'node:path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.ts'],
    globals: false, // explicit imports — easier to follow
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/main.tsx', 'src/setupTests.ts', 'src/test-utils/**', '**/*.test.{ts,tsx}'],
      thresholds: {
        lines: 1, // intentionally low baseline — raise as new tests land
        functions: 1,
        statements: 1,
        branches: 1,
      },
    },
  },
})
