/** Normalise un numéro saisi au format E.164 (+221...) ; null si vide */
export function normaliserTelephone(telephone?: string | null): string | null {
  const t = telephone?.replace(/[^\d+]/g, "");
  if (!t) return null;
  // Numéro local sénégalais à 9 chiffres (77 123 45 67) -> +221
  if (/^\d{9}$/.test(t)) return `+221${t}`;
  if (t.startsWith("00")) return `+${t.slice(2)}`;
  return t.startsWith("+") ? t : `+${t}`;
}
