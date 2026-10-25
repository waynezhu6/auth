# auth

Passkey sign-in for every app on waynezhu.dev. You get one account, and it signs you in to all of them. It has no passwords: signing in is Face ID, a fingerprint or a device PIN, through a passkey your phone or laptop keeps.

- **Login and account page:** `waynezhu.dev/apps/auth/`. Here you sign in, add, rename or remove passkeys, and sign out on this device or everywhere.
- **For other apps:** their backends ask `http://auth-backend:3001/api/verify` who is signed in (see "Using it from an app").

Accounts are invite-only. An invite is a one-time link made on the server.

## First account

After the first deploy, on the server:

```bash
docker exec $(docker ps -q --filter label=deployer.app=auth | head -n1) node dist/cli.js invite --admin
```

This prints a link like `https://waynezhu.dev/apps/auth/invite/…`. Open it on your phone, pick a username and create the passkey.

If your passkeys sync (iCloud Keychain, Google Password Manager, 1Password), they reach your other devices on their own. Otherwise, add one on each device from the account page. A device without a passkey can still sign in by scanning a QR code with your phone.

The same command takes these (the `docker ps` part finds the container, whose name changes with each deploy):

| Command | Does |
|---|---|
| `invite` | A link that creates one new account. It works once, within 7 days. `invite --admin` makes that account an admin. |
| `recover wayne` | A link that adds a passkey to `wayne`'s account, for when every passkey is lost. Old passkeys keep working until you remove them. |
| `admin wayne` / `unadmin wayne` | Make `wayne` an admin, or stop them being one. |
| `users` | Lists accounts and how many passkeys each has. |

## Admin page

Admins get an **Admin** link on their account page, which goes to `/apps/auth/admin`. It lists every account with its passkeys, open sessions and when it was last seen. From there an admin can:

- make invite links and recovery links, so day-to-day you don't need the server
- withdraw unused links
- sign an account out everywhere
- delete an account
- make and revoke API keys (see "API keys")

Changes need a passkey used in the last 15 minutes; otherwise the page asks for it first.

Only the server's command line can make or remove an admin, never the web, and the admin page can't delete an admin. Anyone who can run commands on the server already controls everything on it, so this adds no new way in.

## Using it from an app

App backends run on the same Docker network as this one, so they can ask it directly, passing along the browser's cookies:

```ts
const res = await fetch("http://auth-backend:3001/api/verify", {
  headers: { cookie: req.headers.cookie ?? "" },
});
const user = res.ok ? ((await res.json()) as { id: string; name: string }) : null;
```

If there's no user, send the browser to `/apps/auth/?next=<the page it was on>`. After signing in, it comes straight back. `next` must be a path on waynezhu.dev; anything else is ignored.

Key your data on `user.id`, not the name. app-template's `backend/src/auth.ts` (`requireUser`, `currentUser`) does all of this, API keys included.

## API keys

For callers that can't sign in with a passkey: a script, a cron job on another machine, an iOS Shortcut. An admin makes one on the admin page, for one app, and copies it once (it isn't shown again). It looks like `wz_txtify_…`. Keep it wherever the caller keeps secrets: the calling repo's Actions secrets, a password manager. Never in a repo's files.

The caller sends it to the app as `Authorization: Bearer wz_…`. The app's backend passes it on, with its own name:

```ts
const res = await fetch(`http://auth-backend:3001/api/verify?app=${APP}`, {
  headers: { authorization: req.headers.authorization },
});
// 200 {id, name, key}: the key's owner, and the key's name. 401: no good.
```

- A key acts as the admin who made it, but only in its app: a `txtify` key is refused when `ledger` asks. The app's name comes from the asking backend; apps on the server are trusted with that, as they are with the session cookie.
- A request with a key is judged on the key alone, even if it also carries a cookie.
- Keys can expire (30 days to a year) or never. The page shows when each was last used.
- Revoking deletes the key at once. Deleting an account deletes its keys.
- Only a hash is stored, like sessions.

## How it works

- **Passkeys.** A passkey is a key pair. The device keeps the private key and only uses it after Face ID, a fingerprint or the PIN. This service stores the public key. Signing in means the device signs a random one-time challenge from the server. Passkeys are tied to `waynezhu.dev`, so a look-alike site can't use them. The service uses [SimpleWebAuthn](https://simplewebauthn.dev).
- **Sessions.** Signing in sets the cookie `__Host-auth`: HttpOnly, Secure, SameSite=Lax, for the whole site. Unlike other apps' cookies, it is sent to every app's backend, which is how they can check it. That also means every app on the domain is trusted with it. A session ends after 30 days unused, after a year in any case, or on sign-out. "Sign out everywhere" ends all of an account's sessions.
- **What's stored.** The database holds accounts, passkeys' public keys, and hashes of session tokens and invite links. A leaked copy can't be used to sign in. The nightly backups cover it like every other database.
- **Guards.**
  - Every request that changes something must come from the login page itself (its `Origin` header).
  - Sign-in, sign-up and invite checks are limited to 30 a minute per IP.
  - Challenges work once, for 5 minutes.
  - The page runs only its own scripts (a Content-Security-Policy).
  - An account's last passkey can't be removed.

### API

Express sees these as `/api/...`. Browsers reach them under `/api/auth/...`.

| Route | |
|---|---|
| `GET /api/verify` | `{id, name}` of the signed-in user, or 401. This is for other apps. With `Authorization: Bearer <key>` and `?app=<app>`: `{id, name, key}` of the key's owner, or 401. |
| `GET /api/me` | `{user, passkeys}`, or 401 |
| `POST /api/login/options`, `/api/login/verify` | Sign in with a passkey |
| `POST /api/register/options`, `/api/register/verify` | Create a passkey: with a signup invite and a username for a new account, with a recovery invite, or for the signed-in account |
| `POST /api/logout` | `{everywhere?: true}` |
| `PATCH /api/passkeys/:id`, `DELETE /api/passkeys/:id` | Rename or remove a passkey |
| `GET /api/invites/:token` | Whether an invite link is still good |
| `/api/admin/...` | The admin page's API (`backend/src/admin.ts`), admins only |

## Local dev

```bash
npm install
docker compose -f docker-compose.dev.yml up -d   # local Postgres on 5432
cp backend/.env.example backend/.env             # points passkeys at http://localhost:5173
npm run dev
cd backend && npx tsx --env-file=.env src/cli.ts invite
```

Open the link it prints. Chrome, Edge and Firefox allow passkeys on `localhost`. Chrome's DevTools can also stand in for a phone: **More tools → WebAuthn → Enable virtual authenticator environment**.

```bash
npm test --workspace=backend    # needs the dev Postgres; makes and drops its own database
```

The tests drive real passkey ceremonies with a software authenticator (`backend/test/authenticator.ts`). CI runs them, and builds the image, on every PR.

## Deploying

Like any app from [app-template](https://github.com/waynezhu6/app-template): it's registered in infrastructure (`apps/auth.caddy`), `infra.yml` gives it its database, and a push to `main` deploys it. It needs no secrets.
