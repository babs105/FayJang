/** Fuseau du Sénégal (GMT toute l'année, sans heure d'été) */
export const TIMEZONE = "Africa/Dakar";

/** Date du jour à Dakar au format YYYY-MM-DD */
export function todayDakar(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function isDateValide(date: string | null | undefined): date is string {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  // Aller-retour ISO : une date inexistante (31 février) serait reportée au mois suivant, donc refusée
  const d = new Date(`${date}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date;
}

/** Année scolaire au format « 2026-2027 » */
export function isAnneeScolaireValide(annee: string): boolean {
  const m = /^(\d{4})-(\d{4})$/.exec(annee);
  return Boolean(m && Number(m[2]) === Number(m[1]) + 1);
}

/** Année scolaire en cours à une date (rentrée en septembre ou plus tard : nouvelle année) */
export function anneeScolaireDe(date: string, moisDebut = 10): string {
  const [a, m] = date.split("-").map(Number);
  // La rentrée tombe en général en octobre ; dès septembre on prépare l'année suivante
  const debut = m >= Math.min(moisDebut, 9) ? a : a - 1;
  return `${debut}-${debut + 1}`;
}

/** Mois couverts par les mensualités : ["2026-10-01", "2026-11-01", ...] */
export function moisScolaires(anneeScolaire: string, moisDebut: number, nbMensualites: number): string[] {
  const debut = Number(anneeScolaire.slice(0, 4));
  const mois: string[] = [];
  for (let i = 0; i < nbMensualites; i++) {
    const index = moisDebut - 1 + i;
    const annee = debut + Math.floor(index / 12);
    const m = (index % 12) + 1;
    mois.push(`${annee}-${String(m).padStart(2, "0")}-01`);
  }
  return mois;
}

/** Date d'échéance d'une mensualité : « 2026-10-05 » pour le mois « 2026-10-01 » et le jour 5 */
export function echeanceDuMois(mois: string, jourEcheance: number): string {
  return `${mois.slice(0, 8)}${String(jourEcheance).padStart(2, "0")}`;
}

// Créé une seule fois : formatMois est appelé pour chaque libellé de situationInscription
const FORMAT_MOIS = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });

/** Ex: « octobre 2026 » */
export function formatMois(mois: string): string {
  return FORMAT_MOIS.format(new Date(`${mois.slice(0, 7)}-01T12:00:00Z`));
}

/** Ex: « oct. » */
export function formatMoisCourt(mois: string): string {
  return new Intl.DateTimeFormat("fr-FR", { month: "short", timeZone: "UTC" }).format(new Date(`${mois.slice(0, 7)}-01T12:00:00Z`));
}

/** Ex: « 7 nov. 2026 » */
export function formatDate(date: string): string {
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${date.slice(0, 10)}T12:00:00Z`)
  );
}

/** « novembre 2026 à janvier 2027 », « en octobre 2026 » (un seul mois), ou « dès novembre 2026 » (en cours) */
export function formatPeriode(p: { debut: string | null; fin: string | null }): string {
  if (!p.debut) return "";
  if (!p.fin) return `dès ${formatMois(p.debut)}`;
  return p.fin === p.debut ? `en ${formatMois(p.debut)}` : `de ${formatMois(p.debut)} à ${formatMois(p.fin)}`;
}
