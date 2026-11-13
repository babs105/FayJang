import { getSessionEcole } from "@/lib/securite/ecole-session";
import { createClientEcole } from "@/lib/supabase/server";
import { genererRecuPdf } from "@/lib/documents/recu-pdf";
import { lireDonneesRecu, reponsePdf } from "@/lib/documents/recu-donnees";

export const dynamic = "force-dynamic";

/** Reçu PDF d'un paiement, pour l'école connectée */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionEcole();
  if (!session) return new Response("Session expirée", { status: 401 });
  const { id } = await params;

  const donnees = await lireDonneesRecu(createClientEcole(session), session.ecoleId, id);
  if (!donnees) return new Response("Reçu introuvable", { status: 404 });
  return reponsePdf(await genererRecuPdf(donnees), donnees.numero);
}
