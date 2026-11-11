// Totaux de caisse de l'Espace École (tableau de bord, onglet Paiements).
// Un reçu « Reprise de l'existant » regroupe des versements antérieurs à FayJàng, daté du jour de l'import :
// ce n'est pas de l'argent encaissé ce jour-là. Il compte dans le total de l'année (l'argent a bien été versé),
// jamais dans les totaux du jour, du mois ou par mode.
import { estRecuDeReprise } from "./reprise-recu";

type PaiementCaisse = { montant: number; paye_le: string; annule: boolean; mode: string; encaisse_par: string | null };

/** Encaissement réel de la caisse : non annulé et hors reprise */
export function estEncaissementDeCaisse(p: Pick<PaiementCaisse, "annule" | "encaisse_par">): boolean {
  return !p.annule && !estRecuDeReprise(p.encaisse_par);
}

export interface TotauxCaisse {
  /** Encaissé aujourd'hui (hors reprise) */
  jour: number;
  /** Encaissé ce mois-ci (hors reprise) */
  mois: number;
  /** Ce mois-ci par mode de paiement (hors reprise) */
  parModeMois: Map<string, number>;
  /** Tout ce qui a été versé sur l'année, reprise comprise */
  annee: number;
  /** Part de l'année reprise à l'import */
  reprise: number;
}

export function totauxCaisse(paiements: PaiementCaisse[], aujourdhui: string): TotauxCaisse {
  const moisCourant = aujourdhui.slice(0, 7);
  const t: TotauxCaisse = { jour: 0, mois: 0, parModeMois: new Map(), annee: 0, reprise: 0 };
  for (const p of paiements) {
    if (p.annule) continue;
    t.annee += p.montant;
    if (estRecuDeReprise(p.encaisse_par)) {
      t.reprise += p.montant;
      continue;
    }
    if (p.paye_le === aujourdhui) t.jour += p.montant;
    if (p.paye_le.slice(0, 7) === moisCourant) {
      t.mois += p.montant;
      t.parModeMois.set(p.mode, (t.parModeMois.get(p.mode) ?? 0) + p.montant);
    }
  }
  return t;
}
