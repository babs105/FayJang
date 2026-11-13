import "server-only";
import { createServerClient } from "@supabase/ssr";
import { Database } from "@/types/database";
import type { SupabaseServeur } from "./server";

/**
 * Client Supabase avec la clé service_role : il contourne la RLS.
 * À réserver aux accès multi-écoles par nature : console SuperAdmin, inscription d'une nouvelle école
 * et diagnostic. Tout le reste passe par ./server.ts.
 */
export function createAdminClient(): SupabaseServeur {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || url === "https://votre-projet.supabase.co") {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL manquante ou non remplacée dans l'environnement.");
  }
  if (!serviceKey || serviceKey === "votre-cle-service-role-privee") {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY manquante ou non remplacée dans l'environnement.");
  }

  return createServerClient<Database>(url, serviceKey, {
    cookies: { getAll: () => [], setAll: () => {} },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
