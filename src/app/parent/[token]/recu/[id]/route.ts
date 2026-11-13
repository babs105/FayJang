import { echangerJetonParent } from "@/lib/supabase/server";
import { genererRecuPdf } from "@/lib/recu-pdf";
import { lireDonneesRecu, reponsePdf } from "@/lib/recu-donnees";

export const dynamic = "force-dynamic";

/** Reçu PDF pour un parent : la RLS ne lui montre que les paiements (non annulés) de ses enfants */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params;
  const acces = await echangerJetonParent(token);
  if (!acces) return new Response("Lien invalide", { status: 404 });

  const donnees = await lireDonneesRecu(acces.supabase, acces.ecoleId, id);
  if (!donnees) return new Response("Reçu introuvable", { status: 404 });
  return reponsePdf(await genererRecuPdf(donnees), donnees.numero);
}
