import { createHash, randomBytes } from "crypto";

// Session tokens and invite links: 256 random bits, of which the database
// keeps only a SHA-256 hash.
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}
