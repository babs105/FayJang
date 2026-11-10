/** Horodatage d'une ligne : created_at et updated_at tels que renvoyés par Supabase (ISO 8601) */
export type Horodatage = { created_at: string; updated_at: string };

/**
 * Date de la dernière modification réelle parmi des lignes (élève, inscription, parent, articles) :
 * la plus récente des updated_at postérieures à leur created_at. null si aucune ligne n'a été modifiée
 * après sa création (lignes créées ensemble, ou antérieures à la colonne : updated_at = created_at).
 */
export function derniereModification(lignes: Array<Horodatage | null | undefined>): string | null {
  let plusRecente: string | null = null;
  let tPlusRecente = -Infinity;
  for (const l of lignes) {
    if (!l) continue;
    const creee = Date.parse(l.created_at);
    const modifiee = Date.parse(l.updated_at);
    if (Number.isNaN(creee) || Number.isNaN(modifiee) || modifiee <= creee) continue;
    if (modifiee > tPlusRecente) {
      tPlusRecente = modifiee;
      plusRecente = l.updated_at;
    }
  }
  return plusRecente;
}
