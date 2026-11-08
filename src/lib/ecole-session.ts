import "server-only";
import { createHash, createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { cache } from "react";
import { sessionEncoreValide } from "@/lib/supabase/client-serveur";

const COOKIE_NAME = "fayjang_ecole";
const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 30; // 30 jours

function getSecret(): string {
  const secret = process.env.ECOLE_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("ECOLE_SESSION_SECRET manquant (32 caractères minimum) dans l'environnement.");
  }
  return secret;
}

export function sign(payload: string): string {
  return createHmac("sha256", getSecret()).update(payload).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/** Empreinte sha256 hex du code d'accès, envoyée à la base qui la stocke et la compare en bcrypt */
export function hashCode(code: string): string {
  return createHash("sha256").update(code.trim()).digest("hex");
}

/** Cookie de session École : `ecoleId.emisAt.expiresAt.signature` */
export async function createEcoleSession(ecoleId: string): Promise<void> {
  const emisAt = Math.floor(Date.now() / 1000);
  const expiresAt = emisAt + SESSION_DURATION_SECONDS;
  const payload = `${ecoleId}.${emisAt}.${expiresAt}`;
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DURATION_SECONDS,
  });
}

export async function destroyEcoleSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

/**
 * Id de l'école connectée, ou null. En plus de la signature et de l'expiration, vérifie en base que
 * l'école est active et que le code n'a pas changé depuis l'émission du cookie. Mis en cache par rendu.
 */
export const getEcoleId = cache(async (): Promise<string | null> => {
  const cookieStore = await cookies();
  const value = cookieStore.get(COOKIE_NAME)?.value;
  if (!value) return null;

  const [ecoleId, emisAt, expiresAt, signature] = value.split(".");
  if (!ecoleId || !emisAt || !expiresAt || !signature) return null;
  if (!/^\d{1,12}$/.test(emisAt) || !/^\d{1,12}$/.test(expiresAt)) return null;
  if (!safeEqual(sign(`${ecoleId}.${emisAt}.${expiresAt}`), signature)) return null;
  if (Number(expiresAt) < Math.floor(Date.now() / 1000)) return null;

  const valide = await sessionEncoreValide("session_ecole_valide", {
    p_ecole_id: ecoleId,
    p_emis_at: new Date(Number(emisAt) * 1000).toISOString(),
  });
  return valide ? ecoleId : null;
});
