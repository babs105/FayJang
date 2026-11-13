import type { createClientEcole } from "@/serveur/supabase/server";
import { lireSituationAbonnement, MESSAGE_LECTURE_SEULE, peutEcrire, type SituationAbonnement } from "@/lib/abonnement";

type ClientEcole = ReturnType<typeof createClientEcole>;

/**
 * Lit la situation d'abonnement de l'école connectée, calculée par la base (`abonnement_ecole()`, bloc v1.20).
 * null si la lecture échoue : l'appelant n'affiche rien de faux, et la base reste le seul vrai refus d'écriture.
 */
export async function lireAbonnementEcole(supabase: ClientEcole, origine: string): Promise<SituationAbonnement | null> {
  const { data, error } = await supabase.rpc("abonnement_ecole");
  const situation = error ? null : lireSituationAbonnement(data);
  if (!situation) console.error(`[${origine}] lecture de l'abonnement :`, error?.code ?? "réponse illisible");
  return situation;
}

/**
 * Garde des actions qui écrivent : renvoie le message de refus si l'école est en lecture seule, sinon null.
 * Si la lecture échoue, l'action continue : les triggers de la base refusent de toute façon (FJ403).
 */
export async function refusLectureSeule(supabase: ClientEcole, origine: string): Promise<string | null> {
  const situation = await lireAbonnementEcole(supabase, origine);
  return situation && !peutEcrire(situation.etat) ? MESSAGE_LECTURE_SEULE : null;
}
