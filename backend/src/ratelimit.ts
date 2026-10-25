import type { RequestHandler } from "express";

// A fixed window per client IP, in memory. Caddy sets X-Real-IP to the
// client's address; without it (local dev) the socket's address is used.
export function rateLimit(max: number, windowMs: number): RequestHandler {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (req, res, next) => {
    const now = Date.now();
    if (hits.size > 10_000) {
      for (const [ip, h] of hits) if (h.resetAt <= now) hits.delete(ip);
    }
    const ip = (req.headers["x-real-ip"] as string | undefined) ?? req.socket.remoteAddress ?? "";
    let h = hits.get(ip);
    if (!h || h.resetAt <= now) {
      h = { count: 0, resetAt: now + windowMs };
      hits.set(ip, h);
    }
    if (++h.count > max) {
      res.set("Retry-After", String(Math.ceil((h.resetAt - now) / 1000)));
      res.status(429).json({ error: "Too many attempts. Wait a minute and try again." });
      return;
    }
    next();
  };
}
