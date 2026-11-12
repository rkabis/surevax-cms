import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Per-worktree port + proxy target — populated by scripts/setup-worktree.sh
// via apps/frontend/.env.local. Falls back to the canonical defaults so
// `pnpm dev` still works in a worktree that hasn't been bootstrapped.
// `loadEnv(..., '')` reads non-VITE_ prefixed vars too, but we keep the
// VITE_ prefix here so the same .env.local works in the browser bundle if
// it's ever needed.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, '')
  const devPort = Number(env.VITE_DEV_PORT ?? '5173')
  const apiProxyTarget = env.VITE_API_PROXY_TARGET ?? 'http://localhost:3000'

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@surevax/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: devPort,
      strictPort: true,
      proxy: {
        '/api': {
          target: apiProxyTarget,
          changeOrigin: true,
        },
      },
    },
  }
})
