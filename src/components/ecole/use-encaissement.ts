"use client";

// État de l'encaissement de la fiche élève : ce qui est coché, le montant, le mode, et l'envoi idempotent au serveur.
// L'aperçu reprend le calcul du serveur (lignesAEncaisser) ; le serveur recalcule toujours avant d'encaisser.
import { useRef, useState, type TransitionStartFunction } from "react";
import { cleAEnvoyer, signatureEncaissement } from "@/lib/metier/encaissement";
import { choixALinscription, lignesAEncaisser, paiementLibreAutorise } from "@/lib/metier/scolarite";
import { encaisserPaiement } from "@/app/ecole/actions/encaissement";
import type { EleveVue } from "@/types/ecole";
import type { Situation } from "@/types/commun";
import type { TentativeEncaissement } from "@/types/ecole";

export type Retour = { ok: boolean; texte: string } | null;

export const basculer = (liste: string[], v: string) => (liste.includes(v) ? liste.filter((x) => x !== v) : [...liste, v]);

export function useEncaissement({
  s,
  ins,
  isPending,
  startTransition,
  setRetour,
}: {
  s: Situation | null;
  ins: EleveVue["inscription"];
  isPending: boolean;
  startTransition: TransitionStartFunction;
  setRetour: (r: Retour) => void;
}) {
  const [inscriptionChoisie, setInscriptionChoisie] = useState(false);
  const [moisChoisis, setMoisChoisis] = useState<string[]>([]);
  const [articlesChoisis, setArticlesChoisis] = useState<string[]>([]);
  const [montant, setMontant] = useState("");
  const [mode, setMode] = useState("especes");
  const [reference, setReference] = useState("");
  const [libreCoche, setLibre] = useState(false);
  const [libelle, setLibelle] = useState("");
  const [inclureTranche, setInclureTranche] = useState(true);
  // Clé d'encaissement (idempotence) : une par formulaire, renouvelée selon cleAEnvoyer (succès, changement après refus)
  const cleEncaissement = useRef<string>(crypto.randomUUID());
  const derniereTentative = useRef<TentativeEncaissement | null>(null);
  // Posé de façon synchrone : isPending n'est pas encore à jour au second clic d'un double clic
  const envoiEnCours = useRef(false);

  // Élève parti : pas de paiement libre, même si la case était cochée avant le changement de statut
  const libre = libreCoche && (ins ? paiementLibreAutorise(ins.statut) : false);

  function viderSelection() {
    setInscriptionChoisie(false);
    setMoisChoisis([]);
    setArticlesChoisis([]);
    setMontant("");
  }

  /** Coche tout ce qui est exigible dès l'inscription */
  function choisirDuInscription() {
    if (!s) return;
    const c = choixALinscription(s);
    setLibre(false);
    setMontant("");
    setInscriptionChoisie(!!c.inscription);
    setMoisChoisis(c.mois ?? []);
    setArticlesChoisis(c.articles ?? []);
  }

  // Même calcul que le serveur (lignesAEncaisser) : lignes du reçu, tranche incluse, montant partiel
  const montantSaisi = montant.trim() ? Number(montant.replace(/\D/g, "")) : null;
  const rienChoisi = !inscriptionChoisie && moisChoisis.length === 0 && articlesChoisis.length === 0;
  const calcul =
    s && !libre && !rienChoisi
      ? lignesAEncaisser(s, {
          inscription: inscriptionChoisie,
          mois: moisChoisis,
          articles: articlesChoisis,
          montant: montantSaisi,
          inclure_tranche: inclureTranche,
        })
      : null;
  const apercu = calcul && "lignes" in calcul ? calcul : null;
  // La case « inclure la tranche » s'affiche dès qu'un mois choisi en porte une
  const trancheProposee =
    s && !libre && !montantSaisi && moisChoisis.length > 0 ? lignesAEncaisser(s, { mois: moisChoisis, inclure_tranche: true }) : null;
  const tranche = trancheProposee && "lignes" in trancheProposee ? trancheProposee.tranche : null;
  const totalSelection = libre ? (montantSaisi ?? 0) : (apercu?.lignes.reduce((t, l) => t + l.montant, 0) ?? 0);
  const nbLignes = (inscriptionChoisie ? 1 : 0) + moisChoisis.length + articlesChoisis.length;
  const duInscription = s ? lignesAEncaisser(s, choixALinscription(s)) : null;
  const totalInscription = duInscription && "lignes" in duInscription ? duInscription.lignes.reduce((t, l) => t + l.montant, 0) : 0;

  function encaisser(e: React.FormEvent) {
    e.preventDefault();
    if (!ins || isPending || envoiEnCours.current) return;
    envoiEnCours.current = true;
    const contenu = libre
      ? { inscription_id: ins.id, mode, reference, libre: { libelle, montant } }
      : { inscription_id: ins.id, mode, reference, inscription: inscriptionChoisie, mois: moisChoisis, articles: articlesChoisis, montant, inclure_tranche: inclureTranche };
    const signature = signatureEncaissement(contenu);
    const cle = cleAEnvoyer(cleEncaissement.current, derniereTentative.current, signature, () => crypto.randomUUID());
    cleEncaissement.current = cle;
    setRetour(null);
    startTransition(async () => {
      try {
        const r = await encaisserPaiement({ ...contenu, cle });
        derniereTentative.current = { signature, issue: r.success ? "succes" : "echec_metier" };
        setRetour({ ok: r.success, texte: r.message ?? (r.success ? "Enregistré." : "Opération impossible.") });
        if (r.success) {
          cleEncaissement.current = crypto.randomUUID();
          derniereTentative.current = null;
          viderSelection();
          setReference("");
          setLibelle("");
          setLibre(false);
        }
      } catch {
        // Réponse perdue : l'encaissement a pu être enregistré. Renvoyer avec la même clé renvoie le même reçu sans doublon.
        derniereTentative.current = { signature, issue: "echec_reseau" };
        setRetour({
          ok: false,
          texte: "Connexion interrompue : on ne sait pas si l'encaissement a été enregistré. Cliquez de nouveau sur Encaisser : s'il l'est déjà, le même reçu sera confirmé sans doublon.",
        });
      } finally {
        envoiEnCours.current = false;
      }
    });
  }

  return {
    inscriptionChoisie,
    setInscriptionChoisie,
    moisChoisis,
    setMoisChoisis,
    articlesChoisis,
    setArticlesChoisis,
    montant,
    setMontant,
    mode,
    setMode,
    reference,
    setReference,
    libreCoche,
    setLibre,
    libre,
    libelle,
    setLibelle,
    inclureTranche,
    setInclureTranche,
    viderSelection,
    choisirDuInscription,
    rienChoisi,
    calcul,
    apercu,
    tranche,
    totalSelection,
    nbLignes,
    totalInscription,
    encaisser,
  };
}

export type Encaissement = ReturnType<typeof useEncaissement>;
