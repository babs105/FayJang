import "server-only";
import { createHash, createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { cache } from "react";
import { lireSessionUtilisateur } from "@/serveur/supabase/client-serveur";
import { lireCookieSession, payloadSession } from "@/lib/session-cookie";
import type { RoleUtilisateur } from "@/types/database";

// Nouveau nom depuis D09 (un cookie par utilisateur) : l'ancien cookie « fayjang_ecole » n'est plus lu,
// chacun se reconnecte une fois (décision du 2026-11-12).
const COOKIE_NAME = "fayjang_utilisateur";
const ANCIEN_COOKIE = "fayjang_ecole";
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

/** Empreinte sha256 hex d'un code ou d'un mot de passe, envoyée à la base qui la stocke et la compare en bcrypt */
export function hashCode(code: string): string {
  return createHash("sha256").update(code.trim()).digest("hex");
}

/** Utilisateur connecté à l'Espace École (directeur ou caissier) */
export type SessionEcole = {
  ecoleId: string;
  utilisateurId: string;
  role: RoleUtilisateur;
  nom: string;
  email: string;
};

/** Cookie de session École : `utilisateurId.emisAt.expiresAt.signature` (format dans session-cookie.ts) */
export async function createEcoleSession(utilisateurId: string): Promise<void> {
  const emisAt = Math.floor(Date.now() / 1000);
  const expiresAt = emisAt + SESSION_DURATION_SECONDS;
  const payload = payloadSession(utilisateurId, emisAt, expiresAt);
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DURATION_SECONDS,
  });
  cookieStore.delete(ANCIEN_COOKIE);
}

export async function destroyEcoleSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
  cookieStore.delete(ANCIEN_COOKIE);
}

/**
 * Utilisateur connecté, ou null. En plus de la signature et de l'expiration, vérifie en base que l'utilisateur
 * et son école sont actifs et que son mot de passe n'a pas changé depuis l'émission du cookie (désactivation
 * ou réinitialisation = déconnexion immédiate). Nom, rôle et école viennent de la base, jamais du cookie.
 * Mis en cache par rendu.
 */
export const getSessionEcole = cache(async (): Promise<SessionEcole | null> => {
  const cookieStore = await cookies();
  const lu = lireCookieSession(
    cookieStore.get(COOKIE_NAME)?.value,
    (payload, signature) => safeEqual(sign(payload), signature),
    Math.floor(Date.now() / 1000)
  );
  if (!lu) return null;

  const ligne = await lireSessionUtilisateur(lu.utilisateurId, new Date(lu.emisAt * 1000).toISOString());
  if (!ligne) return null;
  return { ecoleId: ligne.ecole_id, utilisateurId: lu.utilisateurId, role: ligne.role, nom: ligne.nom, email: ligne.email };
});

/** Id de l'école de l'utilisateur connecté, ou null (voir getSessionEcole) */
export async function getEcoleId(): Promise<string | null> {
  return (await getSessionEcole())?.ecoleId ?? null;
}
