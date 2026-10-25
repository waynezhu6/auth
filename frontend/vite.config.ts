import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { basename, resolve } from 'path'

// The app is served at waynezhu.dev/apps/<name>/ and its backend at
// waynezhu.dev/api/<name>/. <name> is the repo name: CI sets APP from it, and
// locally it falls back to the checkout's folder name. Dev uses the same
// paths, so a hardcoded "/..." URL breaks here rather than only in production.
const app = (process.env.APP ?? basename(resolve(import.meta.dirname, '..'))).toLowerCase()
const apiBase = `/api/${app}`

export default defineConfig({
  base: `/apps/${app}/`,
  define: {
    'import.meta.env.VITE_API_BASE': JSON.stringify(apiBase),
  },
  plugins: [react()],
  server: {
    proxy: {
      // Caddy strips the prefix in production; do the same in dev.
      [apiBase]: {
        target: 'http://localhost:3001',
        rewrite: (path) => '/api' + path.slice(apiBase.length),
      },
    },
  },
})
