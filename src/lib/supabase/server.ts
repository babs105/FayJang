import "server-only";
import { serverClient, type SupabaseServeur } from "./client-serveur";
import { getSessionEcole, hashCode, type SessionEcole } from "@/lib/securite/ecole-session";
import type { RoleUtilisateur } from "@/types/database";
import { signerJetonSupabase, type ClaimsFayJang } from "./jeton";
import { ipVisiteur } from "@/lib/securite/ip";

export type { SupabaseServeur };

/**
 * Clients Supabase côté serveur avec la clé anon : la RLS s'applique à chaque requête.
 *
 * Pattern hybride : l'identifiant reçu (cookie École, token parent dans l'URL) est d'abord échangé par
 * une fonction SQL SECURITY DEFINER, puis le serveur signe un JWT court dont les claims (role_app,
 * ecole_id, utilisateur_id, role_utilisateur, parent_id) filtrent les tables. Le JWT ne quitte jamais le serveur.
 * Le client admin (RLS contournée) est réservé à ./admin.ts.
 */

/** Client portant les claims donnés (sans vérification : réservé aux identifiants déjà échangés) */
export function createClientAvecClaims(claims: ClaimsFayJang): SupabaseServeur {
  return serverClient(signerJetonSupabase(claims));
}

/** Client de l'utilisateur connecté (session déjà vérifiée par getSessionEcole) */
export function createClientEcole(session: SessionEcole): SupabaseServeur {
  return createClientAvecClaims({
    role_app: "ecole",
    ecole_id: session.ecoleId,
    utilisateur_id: session.utilisateurId,
    role_utilisateur: session.role,
  });
}

/** Client École à partir du cookie de session, ou null si personne n'est connecté */
export async function createClientEcoleSession(): Promise<{ ecoleId: string; session: SessionEcole; supabase: SupabaseServeur } | null> {
  const session = await getSessionEcole();
  if (!session) return null;
  return { ecoleId: session.ecoleId, session, supabase: createClientEcole(session) };
}

/** Code SQLSTATE levé par controler_tentatives */
const CODE_TROP_DE_TENTATIVES = "FJ429";

/** Connexion refusée parce que l'identifiant est temporairement bloqué ; message lisible par l'utilisateur */
export class TropDeTentativesError extends Error {}

/** Appelle une fonction d'échange SECURITY DEFINER (avec `parServeur` : JWT « connexion » pour l'IP) */
async function appelerEchange<T>(fonction: string, args: Record<string, string>, parServeur = false): Promise<T | null> {
  const client = parServeur ? createClientAvecClaims({ role_app: "connexion" }) : serverClient();
  const { data, error } = await (client as any).rpc(fonction, args);
  if (error?.code === CODE_TROP_DE_TENTATIVES) throw new TropDeTentativesError(error.message);
  if (error) throw new Error(error.message);
  return (data ?? null) as T | null;
}

/** Utilisateur reconnu par echanger_utilisateur_ecole */
export type UtilisateurConnecte = { utilisateurId: string; ecoleId: string; role: RoleUtilisateur; nom: string };

/** Échange e-mail + mot de passe contre l'utilisateur de l'Espace École, ou null si incorrect */
export async function echangerUtilisateurEcole(email: string, motDePasse: string): Promise<UtilisateurConnecte | null> {
  const ip = await ipVisiteur();
  const lignes = await appelerEchange<Array<{ utilisateur_id: string; ecole_id: string; role: RoleUtilisateur; nom: string }>>(
    "echanger_utilisateur_ecole",
    { p_email: email, p_code_hash: hashCode(motDePasse), ...(ip ? { p_ip: ip } : {}) },
    true
  );
  const ligne = lignes?.[0];
  if (!ligne) return null;
  return { utilisateurId: ligne.utilisateur_id, ecoleId: ligne.ecole_id, role: ligne.role, nom: ligne.nom };
}

/** Échange le token du lien magique parent contre un client limité à ce parent */
export async function echangerJetonParent(
  token: string
): Promise<{ parentId: string; ecoleId: string; supabase: SupabaseServeur } | null> {
  if (!/^[0-9a-f]{16,64}$/.test(token)) return null;
  const lignes = await appelerEchange<Array<{ parent_id: string; ecole_id: string }>>("echanger_jeton_parent", {
    p_token: token,
  });
  const ligne = lignes?.[0];
  if (!ligne) return null;
  return {
    parentId: ligne.parent_id,
    ecoleId: ligne.ecole_id,
    supabase: createClientAvecClaims({ role_app: "parent", ecole_id: ligne.ecole_id, parent_id: ligne.parent_id }),
  };
}
