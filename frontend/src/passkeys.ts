import { startAuthentication, startRegistration, WebAuthnError } from '@simplewebauthn/browser'
import { api } from './api'

export interface User {
  id: string
  name: string
}

export interface Passkey {
  id: string
  name: string
  synced: boolean
  createdAt: string
  lastUsedAt: string | null
}

// Calls the backend and turns its {error} replies into thrown Errors whose
// message can be shown as is.
export async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await api(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new HttpError(res.status, data.error ?? 'Something went wrong. Try again.')
  return data as T
}

export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function signIn(): Promise<User> {
  const { flow, options } = await call<{ flow: string; options: never }>('POST', '/login/options', {})
  const response = await ceremony(() => startAuthentication({ optionsJSON: options }))
  return (await call<{ user: User }>('POST', '/login/verify', { flow, response })).user
}

// A new passkey: for a new account (signup invite and name), an existing one
// (recovery invite), or the signed-in account (neither).
export async function createPasskey(body: { invite?: string; name?: string } = {}): Promise<User> {
  const { flow, options } = await call<{ flow: string; options: never }>('POST', '/register/options', body)
  const response = await ceremony(() => startRegistration({ optionsJSON: options }))
  return (await call<{ user: User }>('POST', '/register/verify', { flow, response, label: deviceLabel() })).user
}

// The browser's own errors, in words. Cancelling is common and not an error.
async function ceremony<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (err) {
    const name = err instanceof WebAuthnError ? (err.cause as Error | undefined)?.name : (err as Error).name
    if (name === 'NotAllowedError') throw new Cancelled()
    if (err instanceof WebAuthnError && err.code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') {
      throw new Error('This device already has a passkey for this account.')
    }
    throw new Error((err as Error).message || 'Your browser could not use a passkey.')
  }
}

export class Cancelled extends Error {
  constructor() {
    super('Cancelled.')
  }
}

// A starting name for a new passkey, so the list says where each came from.
function deviceLabel(): string {
  const ua = navigator.userAgent
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad'
  if (/Macintosh/.test(ua)) return 'Mac'
  if (/Android/.test(ua)) return 'Android'
  if (/Windows/.test(ua)) return 'Windows'
  if (/CrOS/.test(ua)) return 'Chromebook'
  if (/Linux/.test(ua)) return 'Linux'
  return 'Passkey'
}

// Where to go after signing in: ?next=, if it's a page on this site. Apps
// send people here as /apps/auth/?next=<their own path>.
export function nextPage(): string | null {
  const next = new URLSearchParams(location.search).get('next')
  if (!next) return null
  try {
    const url = new URL(next, location.origin)
    return url.origin === location.origin ? url.pathname + url.search + url.hash : null
  } catch {
    return null
  }
}
