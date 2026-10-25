# Built from the repo root (context: .) so npm can use the workspace lockfile.
# One image carries the whole app: the backend runs from it, and the server's
# deployer copies the built frontend out of /app/frontend/dist.
FROM node:20.19-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --workspace=backend --include-workspace-root=false
COPY backend backend
RUN npm run build --workspace=backend

FROM node:20.19-alpine AS frontend
# The repo name: the frontend is built for waynezhu.dev/apps/<APP>/.
ARG APP
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --workspace=frontend --include-workspace-root=false
COPY frontend frontend
RUN test -n "$APP" || { echo "Build with --build-arg APP=<repo name>" >&2; exit 1; }
RUN APP="$APP" npm run build --workspace=frontend

FROM node:20.19-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --workspace=backend --include-workspace-root=false --omit=dev
COPY --from=builder /app/backend/dist backend/dist
COPY --from=builder /app/backend/migrations backend/migrations
COPY --from=frontend /app/frontend/dist frontend/dist
WORKDIR /app/backend
# paths.ts builds the app's public URLs (/api/<APP>, /apps/<APP>/) from this;
# the server doesn't pass the name in.
ARG APP
ENV NODE_ENV=production APP=$APP
# The app only reads its files, so it doesn't need root.
USER node
EXPOSE 3001
CMD ["node", "dist/index.js"]
