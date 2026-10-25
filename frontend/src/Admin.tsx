import { useCallback, useEffect, useState } from 'react'
import { call, Cancelled, HttpError, signIn } from './passkeys'
import { Card, date } from './ui'

interface Account {
  id: string
  name: string
  admin: boolean
  createdAt: string
  passkeys: number
  sessions: number
  lastSeenAt: string | null
}

interface Invite {
  id: string
  kind: 'signup' | 'recovery'
  admin: boolean
  userName: string | null
  createdAt: string
  expiresAt: string
}

// Every account and open invite link, for admins. Being an admin is set on
// the server (cli.ts admin <name>); this page can't grant it.
export function Admin() {
  const [data, setData] = useState<{ users: Account[]; invites: Invite[] } | null>(null)
  const [error, setError] = useState('')
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const [{ users }, { invites }] = await Promise.all([
        call<{ users: Account[] }>('GET', '/admin/users'),
        call<{ invites: Invite[] }>('GET', '/admin/invites'),
      ])
      setData({ users, invites })
    } catch (err) {
      if (err instanceof HttpError && err.status === 401) {
        location.replace(`${import.meta.env.BASE_URL}?next=${encodeURIComponent(location.pathname)}`)
      } else {
        setError((err as Error).message)
      }
    }
  }, [])
  useEffect(() => {
    load()
  }, [load])

  // Changes need a recent passkey: if the server asks, get one and retry.
  const run = async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true)
    setError('')
    try {
      try {
        return await action()
      } catch (err) {
        if (!(err instanceof HttpError && err.reauth)) throw err
        await signIn()
        return await action()
      }
    } catch (err) {
      if (!(err instanceof Cancelled)) setError((err as Error).message)
    } finally {
      setBusy(false)
      load()
    }
  }

  const newLink = async (body: { kind: 'signup' } | { kind: 'recovery'; userId: string }) => {
    const res = await run(() => call<{ link: string }>('POST', '/admin/invites', body))
    if (res) setLink(res.link)
  }
  const signOut = (a: Account) => {
    if (confirm(`Sign ${a.name} out everywhere?`)) run(() => call('POST', `/admin/users/${a.id}/logout`))
  }
  const remove = (a: Account) => {
    if (confirm(`Delete ${a.name}? Their passkeys stop working, and apps' data for them is left behind.`)) {
      run(() => call('DELETE', `/admin/users/${a.id}`))
    }
  }
  const withdraw = (i: Invite) => run(() => call('DELETE', `/admin/invites/${i.id}`))

  if (!data) return <Card title="Admin">{error && <p className="error">{error}</p>}</Card>

  return (
    <Card title="Admin" wide>
      <p>
        <a href={import.meta.env.BASE_URL}>← Your account</a>
      </p>
      {error && <p className="error">{error}</p>}

      <h2>Accounts</h2>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Passkeys</th>
            <th>Sessions</th>
            <th>Last seen</th>
            <th>Joined</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data.users.map((a) => (
            <tr key={a.id}>
              <td>
                {a.name}
                {a.admin && <span className="muted"> (admin)</span>}
              </td>
              <td>{a.passkeys}</td>
              <td>{a.sessions}</td>
              <td>{a.lastSeenAt ? date(a.lastSeenAt) : '–'}</td>
              <td>{date(a.createdAt)}</td>
              <td className="cell-actions">
                <button onClick={() => newLink({ kind: 'recovery', userId: a.id })} disabled={busy}>Recovery link</button>
                <button onClick={() => signOut(a)} disabled={busy || a.sessions === 0}>Sign out</button>
                <button onClick={() => remove(a)} disabled={busy || a.admin} title={a.admin ? 'Admins are removed on the server' : undefined}>
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Invite links</h2>
      <button onClick={() => newLink({ kind: 'signup' })} disabled={busy}>New invite link</button>
      {link && (
        <p className="link">
          <input readOnly value={link} onFocus={(e) => e.target.select()} />
          <button onClick={() => navigator.clipboard.writeText(link)}>Copy</button>
        </p>
      )}
      <p className="muted">Each link works once, for 7 days. Only you can see it now; it isn't shown again.</p>
      {data.invites.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Link</th>
              <th>Made</th>
              <th>Expires</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.invites.map((i) => (
              <tr key={i.id}>
                <td>{i.kind === 'recovery' ? `Recovery for ${i.userName}` : i.admin ? 'Sign-up (admin)' : 'Sign-up'}</td>
                <td>{date(i.createdAt)}</td>
                <td>{date(i.expiresAt)}</td>
                <td className="cell-actions">
                  <button onClick={() => withdraw(i)} disabled={busy}>Withdraw</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  )
}
