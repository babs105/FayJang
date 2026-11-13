/** Règles de saisie de la connexion École (e-mail + mot de passe). Partagé client / serveur, sans dépendance. */

export const MOT_DE_PASSE_MIN = 8;
export const MOT_DE_PASSE_MAX = 100;
const EMAIL_MAX = 120;
// Même règle que la contrainte CHECK de utilisateurs_ecole.email (bloc v1.21) et que l'inscription d'une école
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** E-mail en minuscules sans espaces autour, ou null s'il est invalide */
export function normaliserEmail(saisie: unknown): string | null {
  const email = String(saisie ?? "").trim().toLowerCase();
  if (!email || email.length > EMAIL_MAX || !EMAIL.test(email)) return null;
  return email;
}

/** Message d'erreur pour un nouveau mot de passe, ou null s'il est accepté (longueur comptée sans espaces autour) */
export function erreurMotDePasse(motDePasse: string): string | null {
  const longueur = motDePasse.trim().length;
  if (longueur < MOT_DE_PASSE_MIN) return `Le mot de passe doit faire au moins ${MOT_DE_PASSE_MIN} caractères.`;
  if (motDePasse.length > MOT_DE_PASSE_MAX) return `Le mot de passe doit faire au plus ${MOT_DE_PASSE_MAX} caractères.`;
  return null;
}
