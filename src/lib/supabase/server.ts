import "server-only";
import { serverClient, type SupabaseServeur } from "./client-serveur";
import { getEcoleId, hashCode } from "@/lib/ecole-session";
import { signerJetonSupabase, type ClaimsFayJang } from "./jeton";
import { ipVisiteur } from "@/lib/ip";

export type { SupabaseServeur };

/**
 * Clients Supabase côté serveur avec la clé anon : la RLS s'applique à chaque requête.
 *
 * Pattern hybride : l'identifiant reçu (cookie École, token parent dans l'URL) est d'abord échangé par
 * une fonction SQL SECURITY DEFINER, puis le serveur signe un JWT court dont les claims (role_app,
 * ecole_id, parent_id) filtrent les tables. Le JWT ne quitte jamais le serveur.
 * Le client admin (RLS contournée) est réservé à ./admin.ts.
 */

/** Client portant les claims donnés (sans vérification : réservé aux identifiants déjà échangés) */
export function createClientAvecClaims(claims: ClaimsFayJang): SupabaseServeur {
  return serverClient(signerJetonSupabase(claims));
}

/** Client de l'école connectée (cookie de session déjà vérifié par getEcoleId) */
export function createClientEcole(ecoleId: string): SupabaseServeur {
  return createClientAvecClaims({ role_app: "ecole", ecole_id: ecoleId });
}

/** Client École à partir du cookie de session, ou null si personne n'est connecté */
export async function createClientEcoleSession(): Promise<{ ecoleId: string; supabase: SupabaseServeur } | null> {
  const ecoleId = await getEcoleId();
  if (!ecoleId) return null;
  return { ecoleId, supabase: createClientEcole(ecoleId) };
}

/** Code SQLSTATE levé par controler_tentatives */
const CODE_TROP_DE_TENTATIVES = "JP429";

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

/** Échange identifiant (slug ou e-mail) + code contre l'id de l'école, ou null si incorrect */
export async function echangerAccesEcole(identifiant: string, code: string): Promise<string | null> {
  const ip = await ipVisiteur();
  return appelerEchange<string>(
    "echanger_acces_ecole",
    { p_identifiant: identifiant, p_code_hash: hashCode(code), ...(ip ? { p_ip: ip } : {}) },
    true
  );
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
