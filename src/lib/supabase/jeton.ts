import "server-only";
import { createPrivateKey, sign, type KeyObject } from "crypto";

/** Durée de vie d'un JWT : il est signé à chaque requête serveur, il n'a donc pas besoin de durer */
const DUREE_JETON_SECONDES = 5 * 60;

/** Claims lus par les politiques RLS (fonctions public.jwt_* de supabase/schema.sql) */
export type ClaimsJangPay =
  | { role_app: "ecole"; ecole_id: string }
  | { role_app: "parent"; ecole_id: string; parent_id: string }
  // Appel des fonctions de connexion par le serveur : ce rôle n'ouvre aucune table, il atteste seulement
  // que l'appel (et donc l'IP transmise) vient de Next.js et pas d'un appel direct.
  | { role_app: "connexion" };

function base64url(valeur: string | Buffer): string {
  return Buffer.from(valeur).toString("base64url");
}

let cleEnCache: { kid: string; cle: KeyObject } | null = null;

/**
 * Clé privée ES256 importée dans Supabase (Project Settings > JWT Keys), au format JWK :
 * générée par `npx supabase gen signing-key --algorithm ES256`.
 */
function getCleSignature(): { kid: string; cle: KeyObject } {
  if (cleEnCache) return cleEnCache;

  const brut = process.env.SUPABASE_JWT_PRIVATE_KEY;
  if (!brut) {
    throw new Error("SUPABASE_JWT_PRIVATE_KEY manquante dans l'environnement (clé de signature ES256 au format JWK).");
  }

  let jwk: { kid?: string; kty?: string; crv?: string; d?: string };
  try {
    const valeur = JSON.parse(brut);
    jwk = Array.isArray(valeur) ? valeur[0] : valeur;
  } catch {
    throw new Error("SUPABASE_JWT_PRIVATE_KEY n'est pas un JSON valide (JWK attendu).");
  }
  if (jwk?.kty !== "EC" || jwk.crv !== "P-256" || !jwk.d || !jwk.kid) {
    throw new Error("SUPABASE_JWT_PRIVATE_KEY doit être une clé privée EC P-256 (ES256) avec un champ kid.");
  }

  cleEnCache = { kid: jwk.kid, cle: createPrivateKey({ key: jwk as any, format: "jwk" }) };
  return cleEnCache;
}

/** Signe un JWT ES256 accepté par Supabase : role « authenticated » + claims métier filtrés par la RLS */
export function signerJetonSupabase(claims: ClaimsJangPay): string {
  const { kid, cle } = getCleSignature();
  const maintenant = Math.floor(Date.now() / 1000);
  const sujet =
    claims.role_app === "parent" ? claims.parent_id : claims.role_app === "ecole" ? claims.ecole_id : "connexion";

  const entete = base64url(JSON.stringify({ alg: "ES256", typ: "JWT", kid }));
  const contenu = base64url(
    JSON.stringify({
      ...claims,
      sub: sujet,
      role: "authenticated",
      aud: "authenticated",
      iat: maintenant,
      exp: maintenant + DUREE_JETON_SECONDES,
    })
  );
  // Format JWS : signature brute r||s (64 octets), pas l'encodage DER par défaut de Node
  const signature = sign("sha256", Buffer.from(`${entete}.${contenu}`), { key: cle, dsaEncoding: "ieee-p1363" });
  return `${entete}.${contenu}.${base64url(signature)}`;
}
