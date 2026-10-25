import { createApp } from "./app.js";
import { migrate } from "./db.js";
import { pruneSessions } from "./sessions.js";

const PORT = process.env.PORT ?? 3001;
const app = createApp();

// Don't take traffic until the schema is current. A failed migration exits so
// the container restarts instead of serving on a stale schema.
try {
  await migrate();
} catch (err) {
  console.error("Migrations failed:", err);
  process.exit(1);
}

const server = app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});

const prune = setInterval(() => pruneSessions().catch((err) => console.error("Pruning sessions failed:", err)), 6 * 60 * 60 * 1000);
prune.unref();

// A deploy starts the new backend next to this one, then stops this one with
// SIGTERM: finish the requests in flight and exit. Node running as PID 1 in
// the container would otherwise ignore it and be killed mid-request.
process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});
