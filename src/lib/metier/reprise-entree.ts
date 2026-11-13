// Reprise de l'existant : entrée de la répartition d'un élève (tarifs, catalogue, versé), ce qu'elle produit
// (paiements et articles prévus, résumé), et le contrôle défensif de l'entrée.
import { verifierReglages } from "@/lib/metier/scolarite";
import { formatFCFA } from "@/lib/utils";
import type { EntreeRepartition } from "@/types/reprise";

const entier = (n: number | null | undefined) => n === null || n === undefined || (Number.isInteger(n) && n >= 0);

export function controler(e: EntreeRepartition): string | null {
  const reglages = verifierReglages(e.anneeScolaire, e.ecole);
  if (reglages) return `Paramètres de l'école incohérents : ${reglages}`;
  const montants = [e.tarifs.frais, e.tarifs.mensualite, e.tarifs.dernierMois, e.reduction, e.verseScolarite, e.verseArticles];
  for (const a of e.catalogue) montants.push(a.prix, a.quantiteDefaut);
  if (!montants.every(entier)) return "Les montants doivent être des nombres entiers de FCFA, positifs ou nuls.";
  if ((e.reduction ?? 0) > e.tarifs.mensualite) {
    return `La réduction mensuelle (${formatFCFA(e.reduction ?? 0)}) dépasse la mensualité de la classe (${formatFCFA(e.tarifs.mensualite)}).`;
  }
  if (e.statut !== "active" && !e.dateDepart) return "Date de départ obligatoire pour un abandon ou un transfert.";
  return null;
}
