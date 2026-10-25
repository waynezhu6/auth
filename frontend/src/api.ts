// The backend lives at /api/<name>/ (see vite.config.ts). Always go through
// these instead of writing "/api/..." so calls reach this app's backend.
export const API_BASE = import.meta.env.VITE_API_BASE

export function apiUrl(path: string): string {
  return API_BASE + path
}

export function api(path: string, init?: RequestInit): Promise<Response> {
  return fetch(apiUrl(path), init)
}
