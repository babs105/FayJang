import { formatMoisCourt } from "@/lib/metier/dates";
import { libellePaiement } from "@/lib/metier/libelles";
import type { LigneRecu, Recu } from "@/types/commun";

/**
 * Regroupe les lignes de paiement par reçu, en gardant l'ordre d'arrivée (le premier reçu rencontré reste devant).
 * Les anciennes lignes sans `lot_id` forment chacune leur propre reçu. La clé inclut l'inscription :
 * deux élèves ne partagent jamais un reçu.
 */
export function regrouperParRecu<L extends LigneRecu>(lignes: L[]): Recu<L>[] {
  const parCle = new Map<string, Recu<L>>();
  for (const l of lignes) {
    const cle = `${l.inscription_id}:${l.lot_id ?? `ligne-${l.id}`}`;
    let recu = parCle.get(cle);
    if (!recu) {
      recu = { cle, premiere: l, lignes: [], total: 0, totalBrut: 0, annule: true, motif_annulation: null };
      parCle.set(cle, recu);
    }
    recu.lignes.push(l);
    recu.totalBrut += l.montant;
    if (l.annule) {
      recu.motif_annulation ??= l.motif_annulation;
    } else {
      recu.total += l.montant;
      recu.annule = false;
    }
  }
  return [...parCle.values()];
}

/** Résumé de l'objet d'un reçu. Ex : « Mensualité d'octobre 2026 », « 3 mensualités (oct.–déc.) », « Frais d'inscription + 1 mensualité » */
export function resumeRecu(lignes: Pick<LigneRecu, "type" | "mois" | "libelle">[]): string {
  if (lignes.length === 0) return "";
  if (lignes.length === 1) return libellePaiement(lignes[0]);

  const mensualites = lignes.filter((l) => l.type === "mensualite" && l.mois && !l.libelle);
  const mois = [...new Set(mensualites.map((l) => l.mois as string))].sort();
  const partMensualites =
    mois.length === 0
      ? ""
      : mois.length === 1
        ? `${mensualites.length} mensualité${mensualites.length > 1 ? "s" : ""} (${formatMoisCourt(mois[0])})`
        : `${mensualites.length} mensualités (${formatMoisCourt(mois[0])}–${formatMoisCourt(mois[mois.length - 1])})`;

  // Ordre stable (les lignes d'un même lot n'ont pas d'ordre garanti en base) : inscription d'abord, puis alphabétique
  const autresLignes = lignes
    .filter((l) => !mensualites.includes(l))
    .sort((a, b) => Number(b.type === "inscription") - Number(a.type === "inscription") || libellePaiement(a).localeCompare(libellePaiement(b), "fr"));
  const autres = [...new Set(autresLignes.map((l) => libellePaiement(l)))];
  const parts = autres.length > 2 ? [...autres.slice(0, 2), `${autres.length - 2} autre(s) frais`] : autres;
  if (partMensualites) parts.push(partMensualites);
  return parts.join(" + ");
}
