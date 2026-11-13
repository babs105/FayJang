/** Saisie d'un caissier par le directeur (D09). Logique pure, partagée client / serveur. */
import { erreurMotDePasse, normaliserEmail } from "@/lib/securite/mot-de-passe";
import { nomUtilisateurReserve } from "@/lib/metier/reprise-recu";

export const NOM_UTILISATEUR_MAX = 100;

export type SaisieCaissier = { nom: string; email: string; motDePasse: string };

/** Saisie nettoyée, ou le message d'erreur à afficher (mêmes règles que creer_utilisateur_ecole, bloc v1.23) */
export function lireSaisieCaissier(saisie: { nom?: unknown; email?: unknown; motDePasse?: unknown }): SaisieCaissier | string {
  const nom = String(saisie.nom ?? "").trim();
  if (!nom) return "Indiquez le nom du caissier.";
  if (nom.length > NOM_UTILISATEUR_MAX) return `Le nom fait ${NOM_UTILISATEUR_MAX} caractères au plus.`;
  if (nomUtilisateurReserve(nom)) return "Ce nom est réservé : choisissez-en un autre.";
  const email = normaliserEmail(saisie.email);
  if (!email) return "Adresse e-mail invalide.";
  const motDePasse = String(saisie.motDePasse ?? "");
  const refus = erreurMotDePasse(motDePasse);
  if (refus) return refus;
  return { nom, email, motDePasse };
}
