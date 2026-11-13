// Colle partagée par les Server Actions de l'Espace École : session, droits, lecture de l'école.
// PAS de "use server" ici : ces fonctions ne doivent jamais devenir des points d'entrée appelables du navigateur.
import "server-only";
import { getSessionEcole } from "@/lib/ecole-session";
import { createClientEcole } from "@/lib/supabase/server";
import { todayDakar } from "@/lib/config";
import { MODES_PAIEMENT } from "@/lib/libelles";
import { texte } from "@/lib/saisie";
import { peutFaire, type Droit } from "@/lib/droits";
import { refusLectureSeule } from "@/lib/abonnement-ecole";
import type { ModePaiement, RoleUtilisateur } from "@/types/database";

export interface Resultat<T = undefined> {
  success: boolean;
  message?: string;
  data?: T;
}

export const SESSION_EXPIREE = "Session expirée : reconnectez-vous à l'Espace École.";

export type Client = ReturnType<typeof createClientEcole>;

/** Utilisateur connecté et son client (JWT portant l'école, l'utilisateur et son rôle), ou null */
export async function session() {
  const utilisateur = await getSessionEcole();
  if (!utilisateur) return null;
  return { ecoleId: utilisateur.ecoleId, utilisateur, supabase: createClientEcole(utilisateur) };
}

/**
 * Session d'une action qui écrit : comme session(), et refuse en plus une école en lecture seule (abonnement
 * expiré ou suspendu) avant toute lecture ou écriture. Renvoie le message de refus, ou la session.
 */
export async function sessionEcriture() {
  const s = await session();
  if (!s) return SESSION_EXPIREE;
  return (await refusLectureSeule(s.supabase, "ecole/actions")) ?? s;
}

/** D09 : message de refus si le rôle connecté n'a pas ce droit (la base refuse aussi), sinon null */
export function refusDroit(s: { utilisateur: { role: RoleUtilisateur } }, droit: Droit): string | null {
  return peutFaire(s.utilisateur.role, droit) ? null : "Réservé au directeur de l'école.";
}

export async function lireEcole(supabase: ReturnType<typeof createClientEcole>, ecoleId: string) {
  const { data, error } = await supabase
    .from("ecoles")
    .select(
      "id, nom, annee_scolaire, mois_debut, nb_mensualites, jour_echeance, tranches_dernier_mois, mois_debut_tranches, nb_tranches, rang_mois_tranches, premier_mois_a_linscription, dernier_mois_a_linscription"
    )
    .eq("id", ecoleId)
    .single();
  if (error) throw error;
  return data;
}

const MOBILE_MONEY: ModePaiement[] = ["wave", "orange_money", "free_money"];

/** Mode et référence d'un encaissement ; message d'erreur si invalide */
export function lireMode(modeSaisi: unknown, referenceSaisie: unknown): { mode: ModePaiement; reference: string | null } | string {
  const mode = String(modeSaisi || "especes") as ModePaiement;
  if (!MODES_PAIEMENT.includes(mode)) return "Mode de paiement inconnu.";
  const reference = texte(referenceSaisie, 60) || null;
  if (MOBILE_MONEY.includes(mode) && !reference) return "Indiquez la référence de la transaction mobile money.";
  return { mode, reference };
}

/** Premier jour du mois courant à Dakar (YYYY-MM-01) */
export function moisCourant(): string {
  return `${todayDakar().slice(0, 7)}-01`;
}

/** Premier mois dû pour un service pris en cours d'année : le mois courant, borné à l'année scolaire */
export function debutService(mois: string[]): string {
  const courant = moisCourant();
  if (courant <= mois[0]) return mois[0];
  if (courant >= mois[mois.length - 1]) return mois[mois.length - 1];
  return courant;
}
