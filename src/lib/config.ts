import { randomBytes } from "crypto";

export { TIMEZONE, todayDakar } from "@/lib/metier/dates";

export function getAppBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
}

/** Token aléatoire cryptographiquement sûr pour les liens magiques parents (128 bits) */
export function generateToken(bytes = 16): string {
  return randomBytes(bytes).toString("hex");
}
