# app-template

Starter for a service on Wayne's VPS: React + Vite frontend, Express + Postgres backend, deployed by `.github/workflows/deploy.yml`. Server-side details (Caddy, Postgres, registration, secrets) live in the [infrastructure](https://github.com/waynezhu6/infrastructure) repo, not here.

## Creating a new app from this template

When asked to start a new service from this template:

1. Create the new repo from this template (GitHub "Use this template"), named with lowercase letters, digits and dashes. The repo name is the app name everywhere; nothing in the files needs renaming.
2. Register it in the infrastructure repo in the same go: on a branch there, run `scripts/register-app.sh <name>` and open a PR with the new `apps/<name>.caddy`. Tell the user to merge it. The app can then deploy and is live at `waynezhu.dev/apps/<name>/`; there's no DNS step.
3. The new repo needs no secrets: it deploys through infrastructure's deployer with a GitHub OIDC token. App-specific secrets (API keys) go in the repo's Actions secrets, listed by name under `env` in the Deploy step of `deploy.yml` (never `toJSON(secrets)`, which GitHub holds as possibly malicious); never in the repo's files.
4. Then build the app in the new repo.

## Conventions

- Backend is ESM TypeScript (`backend/src`, imports end in `.js`). Routes go under `/api/*`.
- The app lives under a path prefix: frontend at `/apps/<name>/`, backend at `/api/<name>/` (Caddy strips it, so Express still sees `/api/...`). Never hardcode `/` or `/api` URLs: the frontend calls the backend via `api()`/`apiUrl()` in `frontend/src/api.ts`, and the backend uses `API_BASE`/`APP_BASE` from `backend/src/paths.ts` for redirects, links and cookie paths. Cookies use `path: API_BASE`, because all apps share one domain.
- The backend listens on port 3001 and must keep the `/api/health` route.
- Schema changes are migrations: `cd backend && npm run migrate:create -- <name>` (ES modules in `backend/migrations`). They run on startup before the server listens; never edit one that has shipped. During a deploy the new version migrates while the old one is still serving, so a migration must not break the code before it: add freely, drop or rename only in a later deploy. Keep the SIGTERM handler in `backend/src/index.ts`, which lets the old version finish its requests.
- Database access goes through the pool in `backend/src/db.ts`; config comes from `DATABASE_URL` only.
- What the app needs from the server is declared in `infra.yml` (`postgres: true` gives it its database and `DATABASE_URL`). The deployer provisions it on each deploy; settings are listed in infrastructure's README. Don't provision anything by hand.
- Local dev: `docker compose -f docker-compose.dev.yml up -d`, `cp backend/.env.example backend/.env`, `npm run dev`, then open `http://localhost:5173/apps/<folder-name>/`.
- After adding or upgrading a package, commit the updated root `package-lock.json`; CI and the Docker build use `npm ci`.

## Don't change without a reason

- The `deploy.yml` workflow and `backend/Dockerfile`. They carry the contract with the infrastructure repo's deployer: one image `ghcr.io/<owner>/<name>-backend` (built with `--build-arg APP=<name>`) that serves the backend on port 3001 with `/api/health`, and holds the built frontend at `/app/frontend/dist`. How the container runs (name, networks, environment) is defined in infrastructure, not here.
- Don't add server details (hostnames, Caddy config, DB credentials) to this repo; they belong in infrastructure.
