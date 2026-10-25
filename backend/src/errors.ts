import type { NextFunction, Request, RequestHandler, Response } from "express";

// Thrown by handlers for an expected failure; the message goes to the user.
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// Express 4 doesn't catch rejected promises from async handlers.
export function wrap(handler: (req: Request, res: Response) => Promise<unknown>): RequestHandler {
  return (req, res, next) => handler(req, res).catch(next);
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  // body-parser's errors (bad JSON, too large) carry their own status.
  const status = (err as { status?: number }).status;
  if (status && status >= 400 && status < 500) {
    res.status(status).json({ error: "Bad request" });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Something went wrong" });
}
