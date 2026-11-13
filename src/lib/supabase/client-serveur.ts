import "server-only";
import { createServerClient } from "@supabase/ssr";
import type { Database, RoleUtilisateur } from "@/types/database";
import { signerJetonSupabase } from "./jeton";

/**
 * Client Supabase serveur avec la clé anon (la RLS s'applique). Séparé de ./server.ts pour que la
 * session École (ecole-session.ts) puisse appeler des fonctions SQL sans import circulaire.
 */
function configSupabase(): { url: string; cleAnon: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const cleAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || url === "https://votre-projet.supabase.co") {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL manquante ou non remplacée dans l'environnement.");
  }
  if (!cleAnon || cleAnon === "votre-cle-anon-publique") {
    throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY manquante ou non remplacée dans l'environnement.");
  }
  return { url, cleAnon };
}

export function serverClient(jeton?: string) {
  const { url, cleAnon } = configSupabase();
  return createServerClient<Database>(url, cleAnon, {
    // Pas de session Supabase Auth : l'identité vient du JWT signé par le serveur
    cookies: { getAll: () => [], setAll: () => {} },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: jeton ? { headers: { Authorization: `Bearer ${jeton}` } } : undefined,
  });
}

export type SupabaseServeur = ReturnType<typeof serverClient>;

/** Ligne renvoyée par session_utilisateur_valide (bloc v1.21) */
export type LigneSessionUtilisateur = { ecole_id: string; role: RoleUtilisateur; nom: string; email: string };

/**
 * Appelle session_utilisateur_valide avec le JWT « connexion » (la fonction refuse tout autre appelant). Refus si
 * l'appel échoue (réseau, schéma pas encore relancé) : on ne laisse jamais passer une session qu'on n'a pas pu
 * vérifier.
 */
export async function lireSessionUtilisateur(utilisateurId: string, emisAt: string): Promise<LigneSessionUtilisateur | null> {
  const fonction = "session_utilisateur_valide";
  try {
    const client = serverClient(signerJetonSupabase({ role_app: "connexion" }));
    const { data, error } = await (client as any).rpc(fonction, { p_utilisateur_id: utilisateurId, p_emis_at: emisAt });
    if (error) {
      console.error(`[session] ${fonction} :`, error.code);
      return null;
    }
    const ligne = (data as LigneSessionUtilisateur[] | null)?.[0];
    return ligne && (ligne.role === "directeur" || ligne.role === "caissier") ? ligne : null;
  } catch {
    console.error(`[session] ${fonction} : appel impossible`);
    return null;
  }
}
