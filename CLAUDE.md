# auth

Passkey sign-in for every app at `waynezhu.dev`. Pages are at `/apps/auth/`. The API is at `/api/auth/`, and other apps' backends reach it internally at `http://auth-backend:3001/api/verify`. Accounts are invite-only, made with `backend/src/cli.ts` on the server. There are no passwords. Built from [app-template](https://github.com/waynezhu6/app-template): React + Vite frontend, Express + Postgres backend, deployed by `.github/workflows/deploy.yml`. Server-side details (Caddy, Postgres, registration, secrets) live in the [infrastructure](https://github.com/waynezhu6/infrastructure) repo, not here.

## Security rules

- Every ceremony requires user verification (`userVerification: "required"`, `requireUserVerification: true`). Passkeys are discoverable (`residentKey: "required"`), so signing in needs no username. Don't add passwords, email codes, or any other way in that skips a passkey. The way back into an account is a recovery link from the CLI.
- The database keeps only SHA-256 hashes of session tokens and invite links (`tokens.ts`). Challenges are used once (`challenges.ts`) and expire after 5 minutes.
- Every non-GET request must carry `Origin: AUTH_ORIGIN` (`app.ts`). Keep it that way, and don't add CORS. Passkey and invite endpoints are rate-limited per IP, using the `X-Real-IP` header that Caddy sets.
- The session cookie is `__Host-auth` with `path=/`. This deliberately differs from other apps, whose cookies use `API_BASE`: it lets every app's backend see who is signed in. Keep it HttpOnly, Secure and SameSite=Lax.
- Admin is set only by `cli.js` on the server (`admin`, `unadmin`, `invite --admin`). No route may grant it, remove it or delete an admin. Admin routes (`admin.ts`) that change something also need the session's passkey to have been used in the last 15 minutes (`verified_at`).
- `RP_ID` (`waynezhu.dev`) can't change without breaking every passkey.
- `GET /api/verify` (`{id, name}` or 401) is the contract with other apps. Change it only in ways that stay compatible. With a Bearer API key it also needs `?app=` and answers only for that key's app; a request with a key is never judged on its cookie.
- API keys (`apikeys.ts`) are made only by admins with a fresh passkey, each for one app, shown once and stored as a hash.
- The built page has a strict CSP (`vite.config.ts`). Keep scripts and styles in files; inline ones won't run.

## Conventions

- Backend is ESM TypeScript (`backend/src`, imports end in `.js`). Routes go under `/api/*`.
- The app lives under a path prefix: frontend at `/apps/<name>/`, backend at `/api/<name>/` (Caddy strips it, so Express still sees `/api/...`). Never hardcode `/` or `/api` URLs: the frontend calls the backend via `api()`/`apiUrl()` in `frontend/src/api.ts`, and the backend uses `API_BASE`/`APP_BASE` from `backend/src/paths.ts` for redirects, links and cookie paths. Cookies use `path: API_BASE`, because all apps share one domain.
- The backend listens on port 3001 and must keep the `/api/health` route.
- Schema changes are migrations: `cd backend && npm run migrate:create -- <name>` (ES modules in `backend/migrations`). They run on startup before the server listens; never edit one that has shipped. During a deploy the new version migrates while the old one is still serving, so a migration must not break the code before it: add freely, drop or rename only in a later deploy. Keep the SIGTERM handler in `backend/src/index.ts`, which lets the old version finish its requests.
- Database access goes through the pool in `backend/src/db.ts`; config comes from `DATABASE_URL` only.
- What the app needs from the server is declared in `infra.yml` (`postgres: true` gives it its database and `DATABASE_URL`). The deployer provisions it on each deploy; settings are listed in infrastructure's README. Don't provision anything by hand.
- Local dev: `docker compose -f docker-compose.dev.yml up -d`, `cp backend/.env.example backend/.env`, `npm run dev`, then open `http://localhost:5173/apps/auth/`. Make an invite with `cd backend && npx tsx --env-file=.env src/cli.ts invite`.
- Tests: `npm test --workspace=backend` needs a Postgres in `DATABASE_URL` (the dev one by default). Each run makes and drops its own database. `test/authenticator.ts` stands in for a phone's passkey. CI (`.github/workflows/ci.yml`) runs them on PRs.
- After adding or upgrading a package, commit the updated root `package-lock.json`; CI and the Docker build use `npm ci`.

## Don't change without a reason

- The `deploy.yml` workflow and `backend/Dockerfile`. They carry the contract with the infrastructure repo's deployer: one image `ghcr.io/<owner>/<name>-backend` (built with `--build-arg APP=<name>`) that serves the backend on port 3001 with `/api/health`, and holds the built frontend at `/app/frontend/dist`. How the container runs (name, networks, environment) is defined in infrastructure, not here.
- Don't add server details (hostnames, Caddy config, DB credentials) to this repo; they belong in infrastructure.
