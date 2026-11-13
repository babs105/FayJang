import "server-only";
import type { SupabaseServeur } from "@/lib/supabase/server";
import { estRecuDeReprise } from "@/lib/metier/reprise-recu";
import type { DonneesRecu } from "@/lib/documents/recu-pdf";

const CHAMPS_LIGNE = "numero_recu, type, mois, montant, mode, reference, libelle, paye_le, annule, inscription_id, lot_id, encaisse_par, created_at";

/**
 * Lit tout ce qu'il faut pour un reçu avec le client fourni (École ou parent) : la RLS décide de ce qui est
 * visible, et le filtre ecole_id est ajouté en plus. Un reçu regroupe toutes les lignes du même lot
 * (ex : mensualité + tranche du dernier mois). null si le paiement est invisible.
 */
export async function lireDonneesRecu(supabase: SupabaseServeur, ecoleId: string, paiementId: string): Promise<DonneesRecu | null> {
  if (!/^[0-9a-f-]{36}$/.test(paiementId)) return null;
  const { data: p } = await supabase.from("paiements").select(CHAMPS_LIGNE).eq("id", paiementId).eq("ecole_id", ecoleId).maybeSingle();
  if (!p) return null;

  let lignes = [p];
  if (p.lot_id) {
    const { data } = await supabase
      .from("paiements")
      .select(CHAMPS_LIGNE)
      .eq("ecole_id", ecoleId)
      .eq("lot_id", p.lot_id)
      .eq("inscription_id", p.inscription_id)
      .order("mois", { ascending: true, nullsFirst: true });
    if (data?.length) lignes = data;
  }

  const { data: ins } = await supabase
    .from("inscriptions")
    .select("eleve_id, classe_id, annee_scolaire")
    .eq("id", p.inscription_id)
    .eq("ecole_id", ecoleId)
    .maybeSingle();
  if (!ins) return null;

  const [{ data: eleve }, { data: classe }, { data: ecole }] = await Promise.all([
    supabase.from("eleves").select("prenom, nom, matricule").eq("id", ins.eleve_id).eq("ecole_id", ecoleId).maybeSingle(),
    supabase.from("classes").select("nom").eq("id", ins.classe_id).eq("ecole_id", ecoleId).maybeSingle(),
    supabase.from("ecoles").select("nom, ville, adresse, telephone_contact").eq("id", ecoleId).maybeSingle(),
  ]);
  if (!eleve || !ecole) return null;

  return {
    ecole,
    numero: p.numero_recu,
    payeLe: p.paye_le,
    mode: p.mode,
    reference: p.reference,
    reprise: estRecuDeReprise(p.encaisse_par),
    encaissePar: p.encaisse_par,
    annule: lignes.every((l) => l.annule),
    lignes: lignes.map((l) => ({ type: l.type, mois: l.mois, libelle: l.libelle, montant: l.montant, annule: l.annule })),
    eleve,
    classe: classe?.nom ?? "—",
    anneeScolaire: ins.annee_scolaire,
  };
}

export function reponsePdf(pdf: Uint8Array, numero: string | null): Response {
  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="recu-${(numero ?? "fayjang").replace(/[^\w-]/g, "")}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
