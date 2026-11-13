/**
 * Format du cookie de session de l'Espace École : `utilisateurId.emisAt.expiresAt.signature`.
 * Logique pure (signature fournie par l'appelant) : testée sans secret ni base. Voir ecole-session.ts.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SECONDES = /^\d{1,12}$/;

export type CookieSession = { utilisateurId: string; emisAt: number; expiresAt: number };

/** Partie signée du cookie */
export function payloadSession(utilisateurId: string, emisAt: number, expiresAt: number): string {
  return `${utilisateurId}.${emisAt}.${expiresAt}`;
}

/**
 * Lit un cookie de session ; null s'il est mal formé, mal signé ou expiré. `signatureValide(payload, signature)`
 * compare la signature attendue en temps constant ; `maintenant` est en secondes.
 */
export function lireCookieSession(
  valeur: string | undefined,
  signatureValide: (payload: string, signature: string) => boolean,
  maintenant: number
): CookieSession | null {
  if (!valeur) return null;
  const parties = valeur.split(".");
  if (parties.length !== 4) return null;
  const [utilisateurId, emisAt, expiresAt, signature] = parties;
  if (!UUID.test(utilisateurId) || !SECONDES.test(emisAt) || !SECONDES.test(expiresAt) || !signature) return null;
  if (!signatureValide(payloadSession(utilisateurId, Number(emisAt), Number(expiresAt)), signature)) return null;
  if (Number(expiresAt) < maintenant) return null;
  return { utilisateurId, emisAt: Number(emisAt), expiresAt: Number(expiresAt) };
}
