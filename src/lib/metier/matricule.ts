/**
 * Matricule d'un élève : 2 chiffres de l'année de rentrée + numéro d'ordre sur 4 chiffres (ex : 260042).
 * Le numéro suit le plus grand matricule existant de l'année, pas le nombre d'élèves : après une
 * suppression, compter les élèves redonnerait un matricule déjà pris (inscription impossible).
 */
export function matriculeSuivant(prefixe: string, existants: Array<string | null | undefined>): string {
  let max = 0;
  for (const m of existants) {
    if (!m || !m.startsWith(prefixe)) continue;
    const n = Number(m.slice(prefixe.length));
    if (Number.isInteger(n) && n > max) max = n;
  }
  return `${prefixe}${String(max + 1).padStart(4, "0")}`;
}
