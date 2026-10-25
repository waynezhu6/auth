import express from "express";
import { account } from "./account.js";
import { admin } from "./admin.js";
import { ORIGIN } from "./config.js";
import { errorHandler } from "./errors.js";
import { passkeys } from "./passkeys.js";
import { rateLimit } from "./ratelimit.js";

export function createApp({ attemptsPerMinute = 30 } = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "64kb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // Anything that changes state must come from the login pages themselves.
  // Browsers always send Origin on these requests, so another site can't make
  // a signed-in visitor's browser sign out or remove a passkey. There's no
  // CORS: the pages and this API share an origin.
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD" && req.headers.origin !== ORIGIN) {
      res.status(403).json({ error: "Requests must come from the login page" });
      return;
    }
    next();
  });

  // Guessing invite links is hopeless at 256 bits, but don't let anyone try
  // quickly, and keep the passkey endpoints from being hammered.
  const limit = rateLimit(attemptsPerMinute, 60_000);
  app.use(["/api/register", "/api/login", "/api/invites"], limit);

  app.use("/api", passkeys);
  app.use("/api", account);
  app.use("/api", admin);
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not found" });
  });
  app.use(errorHandler);
  return app;
}
