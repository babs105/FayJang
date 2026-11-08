import ExcelJS from "exceljs";
import { getEcoleId } from "@/lib/ecole-session";
import { createClientEcole } from "@/lib/supabase/server";
import { todayDakar } from "@/lib/config";
import { LIBELLE_MODE, libellePaiement } from "@/lib/libelles";
import { situationInscription } from "@/lib/scolarite";

export const dynamic = "force-dynamic";

/** Export Excel de l'année : journal des paiements + état des soldes par élève */
export async function GET() {
  const ecoleId = await getEcoleId();
  if (!ecoleId) return new Response("Session expirée", { status: 401 });
  const supabase = createClientEcole(ecoleId);
  const aujourdhui = todayDakar();

  const { data: ecole } = await supabase
    .from("ecoles")
    .select("nom, slug, annee_scolaire, mois_debut, nb_mensualites, jour_echeance, tranches_dernier_mois, mois_debut_tranches, nb_tranches")
    .eq("id", ecoleId)
    .maybeSingle();
  if (!ecole) return new Response("École introuvable", { status: 404 });

  const [{ data: inscriptions }, { data: eleves }, { data: classes }, { data: parents }] = await Promise.all([
    supabase
      .from("inscriptions")
      .select("id, eleve_id, classe_id, annee_scolaire, frais_inscription, mensualite, reduction_mensuelle, statut")
      .eq("ecole_id", ecoleId)
      .eq("annee_scolaire", ecole.annee_scolaire),
    supabase.from("eleves").select("id, matricule, prenom, nom, parent_id").eq("ecole_id", ecoleId),
    supabase.from("classes").select("id, nom").eq("ecole_id", ecoleId),
    supabase.from("parents").select("id, nom, telephone").eq("ecole_id", ecoleId),
  ]);
  const ids = (inscriptions ?? []).map((i) => i.id);
  const { data: paiements } = ids.length
    ? await supabase
        .from("paiements")
        .select("inscription_id, numero_recu, type, mois, montant, mode, reference, libelle, paye_le, annule, motif_annulation")
        .eq("ecole_id", ecoleId)
        .in("inscription_id", ids)
        .order("paye_le")
    : { data: [] };

  const eleveParId = new Map((eleves ?? []).map((e) => [e.id, e]));
  const classeParId = new Map((classes ?? []).map((c) => [c.id, c.nom]));
  const parentParId = new Map((parents ?? []).map((p) => [p.id, p]));
  const insParId = new Map((inscriptions ?? []).map((i) => [i.id, i]));

  const classeur = new ExcelJS.Workbook();
  classeur.creator = "FayJàng";

  const journal = classeur.addWorksheet("Paiements");
  journal.columns = [
    { header: "Reçu", key: "recu", width: 16 },
    { header: "Date", key: "date", width: 12 },
    { header: "Matricule", key: "matricule", width: 11 },
    { header: "Élève", key: "eleve", width: 28 },
    { header: "Classe", key: "classe", width: 12 },
    { header: "Objet", key: "objet", width: 26 },
    { header: "Mode", key: "mode", width: 14 },
    { header: "Référence", key: "reference", width: 18 },
    { header: "Montant (FCFA)", key: "montant", width: 15 },
    { header: "Statut", key: "statut", width: 30 },
  ];
  for (const p of paiements ?? []) {
    const ins = insParId.get(p.inscription_id);
    const e = ins ? eleveParId.get(ins.eleve_id) : undefined;
    journal.addRow({
      recu: p.numero_recu,
      date: p.paye_le,
      matricule: e?.matricule,
      eleve: e ? `${e.prenom} ${e.nom}` : "",
      classe: ins ? classeParId.get(ins.classe_id) : "",
      objet: libellePaiement(p),
      mode: LIBELLE_MODE[p.mode],
      reference: p.reference,
      montant: p.annule ? 0 : p.montant,
      statut: p.annule ? `Annulé : ${p.motif_annulation ?? ""}` : "Encaissé",
    });
  }

  const soldes = classeur.addWorksheet("Soldes");
  soldes.columns = [
    { header: "Matricule", key: "matricule", width: 11 },
    { header: "Élève", key: "eleve", width: 28 },
    { header: "Classe", key: "classe", width: 12 },
    { header: "Parent", key: "parent", width: 24 },
    { header: "Téléphone", key: "telephone", width: 16 },
    { header: "Payé", key: "paye", width: 13 },
    { header: "Arriéré", key: "arriere", width: 13 },
    { header: "Mois en retard", key: "retard", width: 14 },
    { header: "Reste année", key: "reste", width: 13 },
  ];
  for (const ins of inscriptions ?? []) {
    const e = eleveParId.get(ins.eleve_id);
    const parent = e?.parent_id ? parentParId.get(e.parent_id) : undefined;
    const s = situationInscription(ins, (paiements ?? []).filter((p) => p.inscription_id === ins.id), ecole, aujourdhui);
    soldes.addRow({
      matricule: e?.matricule,
      eleve: e ? `${e.prenom} ${e.nom}` : "",
      classe: classeParId.get(ins.classe_id),
      parent: parent?.nom,
      telephone: parent?.telephone,
      paye: s.totalPaye,
      arriere: s.arriere,
      retard: s.moisEnRetard,
      reste: s.resteAnnee,
    });
  }

  for (const feuille of [journal, soldes]) {
    feuille.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    feuille.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF059669" } };
    feuille.views = [{ state: "frozen", ySplit: 1 }];
  }

  const tampon = await classeur.xlsx.writeBuffer();
  return new Response(tampon as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="fayjang-${ecole.slug}-${ecole.annee_scolaire}.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
