import type { Paiement } from "@/types/database";
import type { LigneEncaissement, LigneRpc, ResultatEncaissement, TentativeEncaissement } from "@/types/ecole";

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

/** Empreinte du contenu saisi (ce que l'administration a choisi) : deux envois identiques ont la même signature */
export function signatureEncaissement(contenu: Record<string, unknown>): string {
  return JSON.stringify(contenu);
}

/**
 * Clé d'encaissement à envoyer maintenant. On garde la clé tant que renvoyer est sans risque :
 * - jamais envoyé : la clé du formulaire ;
 * - après une erreur réseau : la même clé, même si la sélection a changé (la base a pu enregistrer le premier envoi,
 *   seule la clé permet alors de retrouver son reçu) ;
 * - après un succès (rejeu compris) : une nouvelle clé, le prochain encaissement est un autre reçu ;
 * - après un refus de l'action : la même clé pour le même contenu, une nouvelle clé dès que le contenu change.
 */
export function cleAEnvoyer(cle: string, derniere: TentativeEncaissement | null, signature: string, generer: () => string): string {
  if (!derniere) return cle;
  switch (derniere.issue) {
    case "succes":
      return generer();
    case "echec_metier":
      return derniere.signature === signature ? cle : generer();
    case "echec_reseau":
      return cle;
  }
}

/** Résultat d'une annulation de reçu selon le nombre de lignes réellement passées à « annulé » (0 = déjà annulé par un autre poste) */
export function messageAnnulation(nbLignes: number): { success: boolean; message: string } {
  if (nbLignes <= 0) return { success: false, message: "Ce reçu est déjà annulé." };
  return { success: true, message: "Reçu annulé (toutes ses lignes). Il reste visible, barré « ANNULÉ »." };
}
