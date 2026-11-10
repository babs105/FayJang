import type { LigneEncaissement } from "@/lib/scolarite";
import type { Paiement } from "@/types/database";

/**
 * Aide à l'encaissement atomique (fonction SQL encaisser_paiement) : logique pure, testée sans base.
 */

/**
 * Empreinte des paiements d'une inscription, lue par le serveur avant l'encaissement :
 * nombre de lignes (annulées comprises) et total des lignes non annulées. La base la recalcule sous verrou ;
 * si elle diffère, un autre encaissement ou une annulation est passé entre-temps et rien n'est enregistré.
 */
export function empreintePaiements(paiements: Pick<Paiement, "montant" | "annule">[]): { nb: number; total: number } {
  return {
    nb: paiements.length,
    total: paiements.filter((p) => !p.annule).reduce((s, p) => s + p.montant, 0),
  };
}

/** Ligne au format attendu par encaisser_paiement (p_lignes) */
export type LigneRpc = {
  type: LigneEncaissement["type"];
  mois: string | null;
  article_id: string | null;
  montant: number;
  libelle: string | null;
};

/** Lignes calculées par le serveur, mises au format du JSON de la fonction SQL (aucun champ en trop) */
export function lignesPourRpc(lignes: LigneEncaissement[]): LigneRpc[] {
  return lignes.map((l) => ({
    type: l.type,
    mois: l.mois,
    article_id: l.article_id,
    montant: l.montant,
    libelle: l.libelle,
  }));
}

const FORMAT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Clé d'idempotence envoyée par le navigateur (UUID, majuscules acceptées) : renvoyée en minuscules, ou null si invalide */
export function lireCleEncaissement(cle: unknown): string | null {
  if (typeof cle !== "string") return null;
  const valeur = cle.trim();
  return FORMAT_UUID.test(valeur) ? valeur.toLowerCase() : null;
}

/** Résultat de encaisser_paiement */
export interface ResultatEncaissement {
  numero_recu: string | null;
  montant_encaisse: number;
  ids: string[];
  /** Vrai si la clé avait déjà servi pour exactement cet encaissement : rien n'a été ajouté */
  rejoue: boolean;
}

/** Relit le JSON renvoyé par la base sans lui faire confiance sur sa forme ; null si inattendu */
export function lireResultatEncaissement(data: unknown): ResultatEncaissement | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.ids) || typeof d.montant_encaisse !== "number") return null;
  return {
    numero_recu: typeof d.numero_recu === "string" ? d.numero_recu : null,
    montant_encaisse: d.montant_encaisse,
    ids: d.ids.filter((x): x is string => typeof x === "string"),
    rejoue: d.rejoue === true,
  };
}
