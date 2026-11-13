// Lecture des champs saisis dans les formulaires de l'Espace École (validation à la main, sans Zod)

/** Texte saisi, sans espaces autour, coupé à `max` caractères */
export function texte(valeur: unknown, max = 120): string {
  return String(valeur ?? "").trim().slice(0, max);
}

/** Montant FCFA saisi (« 25 000 », « 25000 ») ; null si invalide */
export function montant(valeur: unknown): number | null {
  const n = Number(String(valeur ?? "").replace(/[\s  .]/g, ""));
  return Number.isInteger(n) && n >= 0 && n <= 50_000_000 ? n : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Identifiant UUID bien formé (sinon la base refuserait le cast avec une erreur générique) */
export function estUuid(valeur: unknown): valeur is string {
  return typeof valeur === "string" && UUID.test(valeur);
}
