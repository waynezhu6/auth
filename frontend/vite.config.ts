import { defineConfig, type Plugin } from 'vite'
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
  plugins: [react(), csp()],
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

// The built page may only run its own scripts and talk to its own origin, so
// nothing injected into it could reach the passkey or session APIs. Dev
// skips it: Vite's hot reload needs inline scripts.
function csp(): Plugin {
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join('; ')
  return {
    name: 'csp',
    apply: 'build',
    transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: policy }, injectTo: 'head-prepend' }],
  }
}
