import { basename, resolve } from "path";

// Public URL prefixes for this app. Caddy strips /api/<name> before requests
// reach Express, so routes are still declared under /api. Use these only for
// URLs the backend hands to the browser: redirects, links, cookie paths.
// APP is baked into the image (backend/Dockerfile); locally it's the checkout's folder name,
// matching the frontend's vite.config.ts.
const APP = (process.env.APP ?? basename(resolve(import.meta.dirname, "../.."))).toLowerCase();

/** e.g. /api/notes. Cookies should use this as their path. */
export const API_BASE = `/api/${APP}`;
/** e.g. /apps/notes/ */
export const APP_BASE = `/apps/${APP}/`;
