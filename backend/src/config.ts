// Where the login pages are served from. Passkeys are bound to RP_ID (the
// "relying party"), so one passkey signs in to every app under it. Changing
// RP_ID later would make every existing passkey stop working.
//
// Production uses the defaults. Locally, backend/.env points them at Vite's
// dev server (http://localhost:5173, RP ID localhost).
export const ORIGIN = process.env.AUTH_ORIGIN ?? "https://waynezhu.dev";
export const RP_ID = process.env.AUTH_RP_ID ?? "waynezhu.dev";
export const RP_NAME = process.env.AUTH_RP_NAME ?? "waynezhu.dev";

// The session cookie. __Host- makes the browser insist on Secure, path=/ and
// no Domain, so no other subdomain or path can set or shadow it. path=/ is
// deliberate, unlike other apps' cookies: it is what lets every app's backend
// see who is signed in.
export const SESSION_COOKIE = "__Host-auth";

const DAY = 24 * 60 * 60 * 1000;
// A session ends after this long unused, or SESSION_MAX_MS after sign-in.
export const SESSION_IDLE_MS = 30 * DAY;
export const SESSION_MAX_MS = 365 * DAY;
export const INVITE_TTL_MS = 7 * DAY;
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;

// Usernames: what other apps see as the user's name.
export const USERNAME = /^[a-z0-9][a-z0-9_-]{1,31}$/;
