/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** This app's backend, e.g. /api/notes. Set in vite.config.ts. */
  readonly VITE_API_BASE: string
}
