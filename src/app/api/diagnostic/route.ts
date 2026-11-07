import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientEcole } from "@/lib/supabase/server";
import { safeEqual } from "@/lib/ecole-session";

export const dynamic = "force-dynamic";

const VALEURS_EXEMPLE = ["https://votre-projet.supabase.co", "votre-cle-anon-publique", "votre-cle-service-role-privee"];

function etat(nom: string): "ok" | "absente" | "valeur d'exemple" {
  const valeur = process.env[nom]?.trim();
  if (!valeur) return "absente";
  if (VALEURS_EXEMPLE.includes(valeur)) return "valeur d'exemple";
  return "ok";
}

function introuvable() {
  return new NextResponse(null, { status: 404, headers: { "Cache-Control": "no-store" } });
}

/** En-tête x-diagnostic-secret égal à DIAGNOSTIC_SECRET ; sans lui, ouvert seulement en développement */
function accesAutorise(request: Request): boolean {
  const secret = process.env.DIAGNOSTIC_SECRET?.trim();
  if (!secret) return process.env.NODE_ENV !== "production";
  if (secret.length < 16) return false;
  return safeEqual(request.headers.get("x-diagnostic-secret") ?? "", secret);
}

function echec(contexte: string, err: unknown): string {
  const code = (err as any)?.code;
  console.error(`[diagnostic] ${contexte} :`, code ?? "erreur");
  return code ? `échec (${code})` : "échec";
}

/** Diagnostic de configuration : variables présentes (jamais leur valeur), connexion Supabase, JWT + RLS */
export async function GET(request: Request) {
  if (!accesAutorise(request)) return introuvable();

  const variables = Object.fromEntries(
    [
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "SUPABASE_JWT_PRIVATE_KEY",
      "ECOLE_SESSION_SECRET",
      "NEXT_PUBLIC_APP_URL",
      "SUPERADMIN_CODE",
      "WAVE_NUMERO_PAIEMENT",
      "DIAGNOSTIC_SECRET",
    ].map((n) => [n, etat(n)])
  );

  let connexionSupabase: string;
  try {
    const { error } = await createAdminClient().from("ecoles").select("id", { count: "exact", head: true });
    connexionSupabase = error ? echec("connexion", error) : "ok";
  } catch (err) {
    connexionSupabase = echec("connexion", err);
  }

  // JWT signé par le serveur et accepté par Supabase : une école fictive ne voit aucune ligne
  let jwtRls: string;
  try {
    const { data, error } = await createClientEcole("00000000-0000-0000-0000-000000000000").from("ecoles").select("id").limit(1);
    jwtRls = error ? echec("jwt", error) : (data ?? []).length === 0 ? "ok" : "ATTENTION : la RLS laisse passer des lignes";
  } catch (err) {
    jwtRls = echec("jwt", err);
  }

  return NextResponse.json(
    { variables, connexionSupabase, jwtRls, commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null },
    { headers: { "Cache-Control": "no-store" } }
  );
}
