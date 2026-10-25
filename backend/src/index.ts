import express from "express";
import cors from "cors";
import { migrate } from "./db.js";

const app = express();
app.disable("x-powered-by");
const PORT = process.env.PORT ?? 3001;

app.use(cors({ origin: process.env.CORS_ORIGIN ?? "http://localhost:5173" }));
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

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

// A deploy starts the new backend next to this one, then stops this one with
// SIGTERM: finish the requests in flight and exit. Node running as PID 1 in
// the container would otherwise ignore it and be killed mid-request.
process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});
