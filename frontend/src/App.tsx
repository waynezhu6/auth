import { useCallback, useEffect, useState } from 'react'
import { browserSupportsWebAuthn } from '@simplewebauthn/browser'
import { Admin } from './Admin'
import { Card, date } from './ui'
import { call, Cancelled, createPasskey, HttpError, nextPage, signIn, type Passkey, type User } from './passkeys'

// One page, a few views: an invite link (/apps/auth/invite/<token>), the
// admin page (/apps/auth/admin), the sign-in button, or the signed-in account.
function App() {
  const path = location.pathname.slice(import.meta.env.BASE_URL.length)
  const invite = path.match(/^invite\/([\w-]+)$/)?.[1]

  if (!browserSupportsWebAuthn()) {
    return (
      <Card title="Passkeys aren't available">
        <p>This browser can't use passkeys. Try an up-to-date Safari, Chrome, Edge or Firefox.</p>
      </Card>
    )
  }
  if (invite) return <Invite token={invite} />
  if (path === 'admin') return <Admin />
  return <Home />
}

function Home() {
  const [state, setState] = useState<{ user: User; passkeys: Passkey[] } | null | undefined>(undefined)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      setState(await call<{ user: User; passkeys: Passkey[] }>('GET', '/me'))
    } catch (err) {
      if (err instanceof HttpError && err.status === 401) setState(null)
      else setError((err as Error).message)
    }
  }, [])
  const done = useCallback(() => {
    const next = nextPage()
    if (next) location.replace(next)
    else load()
  }, [load])

  // Already signed in and sent here by an app: go straight back.
  useEffect(() => {
    call<{ user: User }>('GET', '/me').then(() => (nextPage() ? done() : load()), () => load())
  }, [load, done])

  if (error) return <Card title="Something went wrong"><p className="error">{error}</p></Card>
  if (state === undefined) return null
  if (state === null) return <SignIn onSignedIn={done} />
  return <Account {...state} reload={load} />
}

function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const go = async () => {
    setBusy(true)
    setError('')
    try {
      await signIn()
      onSignedIn()
    } catch (err) {
      if (!(err instanceof Cancelled)) setError((err as Error).message)
      setBusy(false)
    }
  }
  return (
    <Card title="Sign in">
      <p>Use the passkey you made for waynezhu.dev. Your device will ask for Face ID, a fingerprint or its PIN.</p>
      <button className="primary" onClick={go} disabled={busy}>
        {busy ? 'Waiting for your passkey…' : 'Sign in with a passkey'}
      </button>
      {error && <p className="error">{error}</p>}
      <p className="muted">No account? Accounts are by invitation only.</p>
    </Card>
  )
}

function Invite({ token }: { token: string }) {
  const [invite, setInvite] = useState<{ kind: 'signup' | 'recovery'; name?: string } | null>(null)
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    call<{ kind: 'signup' | 'recovery'; name?: string }>('GET', `/invites/${token}`).then(setInvite, (err) => setError(err.message))
  }, [token])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await createPasskey(invite?.kind === 'signup' ? { invite: token, name } : { invite: token })
      // The link is used up; the account page is the place to land.
      location.replace(import.meta.env.BASE_URL)
    } catch (err) {
      if (!(err instanceof Cancelled)) setError((err as Error).message)
      setBusy(false)
    }
  }

  if (!invite) {
    return <Card title="Invite">{error ? <p className="error">{error}</p> : null}</Card>
  }
  if (invite.kind === 'recovery') {
    return (
      <Card title={`Recover ${invite.name}`}>
        <p>Make a new passkey for this account on this device. Your old passkeys keep working until you remove them.</p>
        <form onSubmit={submit}>
          <button className="primary" disabled={busy}>{busy ? 'Waiting for your passkey…' : 'Create a passkey'}</button>
        </form>
        {error && <p className="error">{error}</p>}
      </Card>
    )
  }
  return (
    <Card title="Create your account">
      <p>Pick a username, then make a passkey. Your device will ask for Face ID, a fingerprint or its PIN. There's no password.</p>
      <form onSubmit={submit}>
        <label>
          Username
          <input
            value={name}
            onChange={(e) => setName(e.target.value.toLowerCase())}
            autoComplete="username webauthn"
            autoCapitalize="none"
            spellCheck={false}
            pattern="[a-z0-9][a-z0-9_\-]{1,31}"
            title="2 to 32 lowercase letters, digits, - or _"
            required
            autoFocus
          />
        </label>
        <button className="primary" disabled={busy}>{busy ? 'Waiting for your passkey…' : 'Create account'}</button>
      </form>
      {error && <p className="error">{error}</p>}
    </Card>
  )
}

function Account({ user, passkeys, reload }: { user: User; passkeys: Passkey[]; reload: () => Promise<void> }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    try {
      await action()
      await reload()
    } catch (err) {
      if (!(err instanceof Cancelled)) setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const signOut = (everywhere: boolean) =>
    run(async () => {
      await call('POST', '/logout', { everywhere })
    })
  const rename = (p: Passkey) => {
    const name = prompt('Name this passkey', p.name)
    if (name !== null) run(() => call('PATCH', `/passkeys/${encodeURIComponent(p.id)}`, { name }))
  }
  const remove = (p: Passkey) => {
    if (confirm(`Remove "${p.name}"? It won't be able to sign in anymore.`)) {
      run(() => call('DELETE', `/passkeys/${encodeURIComponent(p.id)}`))
    }
  }

  return (
    <Card title={`Signed in as ${user.name}`}>
      <p className="muted">This account signs you in to every app on waynezhu.dev.</p>
      {user.admin && (
        <p>
          <a href={`${import.meta.env.BASE_URL}admin`}>Admin</a>
        </p>
      )}
      <h2>Passkeys</h2>
      <ul className="passkeys">
        {passkeys.map((p) => (
          <li key={p.id}>
            <div>
              <strong>{p.name}</strong>
              <span className="muted">
                {p.synced ? 'Synced between your devices' : 'On one device or security key'} · added {date(p.createdAt)}
                {p.lastUsedAt && ` · last used ${date(p.lastUsedAt)}`}
              </span>
            </div>
            <div className="actions">
              <button onClick={() => rename(p)} disabled={busy}>Rename</button>
              <button onClick={() => remove(p)} disabled={busy || passkeys.length === 1} title={passkeys.length === 1 ? 'Add another passkey before removing this one' : undefined}>
                Remove
              </button>
            </div>
          </li>
        ))}
      </ul>
      <button onClick={() => run(() => createPasskey())} disabled={busy}>Add a passkey</button>
      <p className="muted">Add one on each device that doesn't share passkeys with the others, so losing one doesn't lock you out.</p>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button onClick={() => signOut(false)} disabled={busy}>Sign out</button>
        <button onClick={() => signOut(true)} disabled={busy}>Sign out everywhere</button>
      </div>
    </Card>
  )
}

export default App
