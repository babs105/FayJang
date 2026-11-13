/**
 * Messages d'erreur montrés à l'école ou au parent. Une erreur Postgres brute révèle des noms de tables,
 * de colonnes ou de contraintes : on ne la renvoie jamais telle quelle.
 */

/** Erreur dont le message est écrit pour l'utilisateur */
export class ErreurAffichable extends Error {}

/** Codes levés par nos fonctions et triggers SQL, au message écrit en français pour l'utilisateur */
const CODES_METIER = new Set(["FJ403", "FJ404", "FJ412", "FJ422", "FJ429"]);

/**
 * Nom de la contrainte CHECK violée (erreur Postgres 23514), ou null. Sert à choisir un message précis sans
 * chercher un mot dans le texte : « date_depart » peut figurer dans le nom d'une autre contrainte.
 */
export function contrainteViolee(err: unknown): string | null {
  const e = err as { code?: unknown; message?: unknown; details?: unknown } | null;
  if (!e || e.code !== "23514") return null;
  const texte = `${typeof e.message === "string" ? e.message : ""} ${typeof e.details === "string" ? e.details : ""}`;
  return /constraint "([a-z0-9_]+)"/i.exec(texte)?.[1] ?? null;
}

/** Traduit une erreur en message lisible. `doublon` : message pour une valeur déjà utilisée (23505) */
export function messageErreur(
  contexte: string,
  err: unknown,
  defaut = "Opération impossible pour le moment, réessayez.",
  doublon?: string
): string {
  if (err instanceof ErreurAffichable) return err.message;
  const code = typeof (err as any)?.code === "string" ? (err as any).code : undefined;
  const message = (err as any)?.message;
  if (code && CODES_METIER.has(code) && typeof message === "string" && message) return message;
  if (code === "23505" && doublon) return doublon;
  console.error(`[${contexte}]`, code ?? "erreur");
  // En local, le code aide à diagnostiquer (ex : 42703 = colonne inconnue) ; jamais en production
  return process.env.NODE_ENV !== "production" && code ? `${defaut} (code ${code})` : defaut;
}
