import ExcelJS from "exceljs";
import { getSessionEcole } from "@/lib/ecole-session";
import { createClientEcole } from "@/lib/supabase/server";
import { todayDakar } from "@/lib/config";
import { LIBELLE_MODE, LIBELLE_STATUT_INSCRIPTION, libellePaiement } from "@/lib/libelles";
import { situationInscription } from "@/lib/scolarite";
import { LectureTropLongue, TAILLE_PAGE, comparer, toutLire, toutLireParIds } from "@/lib/lecture-paginee";
import { estRecuDeReprise } from "@/lib/reprise-recu";
import { celluleTexte } from "@/lib/export-sur";

export const dynamic = "force-dynamic";

/** Export Excel de l'année : journal des paiements + état des soldes par élève */
export async function GET() {
  const session = await getSessionEcole();
  if (!session) return new Response("Session expirée", { status: 401 });
  const { ecoleId } = session;
  const supabase = createClientEcole(session);
  const aujourdhui = todayDakar();

  const { data: ecole } = await supabase
    .from("ecoles")
    .select("nom, slug, annee_scolaire, mois_debut, nb_mensualites, jour_echeance, tranches_dernier_mois, mois_debut_tranches, nb_tranches, rang_mois_tranches, premier_mois_a_linscription, dernier_mois_a_linscription")
    .eq("id", ecoleId)
    .maybeSingle();
  if (!ecole) return new Response("École introuvable", { status: 404 });

  // Lectures paginées (1000 lignes au plus par appel) ; paiements et articles par paquets d'inscriptions
  let inscriptions, eleves, classes, parents, paiements, articles;
  try {
    [inscriptions, eleves, classes, parents] = await Promise.all([
      toutLire((apres) =>
        supabase
          .from("inscriptions")
          .select("id, eleve_id, classe_id, annee_scolaire, frais_inscription, mensualite, mensualite_dernier_mois, reduction_mensuelle, statut, date_depart")
          .eq("ecole_id", ecoleId)
          .eq("annee_scolaire", ecole.annee_scolaire)
          .gt("id", apres)
          .order("id")
          .limit(TAILLE_PAGE)
      ),
      toutLire((apres) => supabase.from("eleves").select("id, matricule, prenom, nom, parent_id").eq("ecole_id", ecoleId)
          .gt("id", apres)
          .order("id")
          .limit(TAILLE_PAGE)),
      toutLire((apres) => supabase.from("classes").select("id, nom").eq("ecole_id", ecoleId)
          .gt("id", apres)
          .order("id")
          .limit(TAILLE_PAGE)),
      toutLire((apres) => supabase.from("parents").select("id, nom, telephone").eq("ecole_id", ecoleId)
          .gt("id", apres)
          .order("id")
          .limit(TAILLE_PAGE)),
    ]);
    const ids = inscriptions.map((i) => i.id);
    [paiements, articles] = await Promise.all([
      toutLireParIds(ids, (paquet, apres) =>
        supabase
          .from("paiements")
          .select("id, inscription_id, numero_recu, type, mois, montant, mode, reference, libelle, paye_le, annule, motif_annulation, article_id, encaisse_par")
          .eq("ecole_id", ecoleId)
          .in("inscription_id", paquet)
          .gt("id", apres)
          .order("id")
          .limit(TAILLE_PAGE)
      ),
      toutLireParIds(ids, (paquet, apres) =>
        supabase
          .from("articles_inscription")
          .select("id, inscription_id, libelle, nature, prix_unitaire, quantite, obligatoire, mois_debut, mois_fin")
          .eq("ecole_id", ecoleId)
          .in("inscription_id", paquet)
          .gt("id", apres)
          .order("id")
          .limit(TAILLE_PAGE)
      ),
    ]);
  } catch (err) {
    console.error("[ecole/export] lecture des données :", err instanceof LectureTropLongue ? "trop de lignes" : ((err as { code?: string })?.code ?? "erreur"));
    return new Response("Export impossible pour le moment, réessayez.", { status: 500 });
  }
  // Journal dans l'ordre des dates (la lecture par paquets ne garde pas d'ordre global)
  paiements.sort((x, y) => comparer(`${x.paye_le}|${x.numero_recu ?? ""}`, `${y.paye_le}|${y.numero_recu ?? ""}`, x.id, y.id));

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
      // Texte libre (saisi ou importé) : neutralisé pour ne jamais être lu comme une formule
      matricule: celluleTexte(e?.matricule),
      eleve: celluleTexte(e ? `${e.prenom} ${e.nom}` : ""),
      classe: celluleTexte(ins ? classeParId.get(ins.classe_id) : ""),
      objet: celluleTexte(libellePaiement(p)),
      mode: LIBELLE_MODE[p.mode],
      reference: celluleTexte(p.reference),
      montant: p.annule ? 0 : p.montant,
      // Reprise : versement antérieur à FayJàng, daté du jour de l'import (pas un encaissement de ce jour)
      statut: p.annule ? `Annulé : ${p.motif_annulation ?? ""}` : estRecuDeReprise(p.encaisse_par) ? "Reprise de l'existant" : "Encaissé",
    });
  }

  const soldes = classeur.addWorksheet("Soldes");
  soldes.columns = [
    { header: "Matricule", key: "matricule", width: 11 },
    { header: "Élève", key: "eleve", width: 28 },
    { header: "Classe", key: "classe", width: 12 },
    { header: "Parent", key: "parent", width: 24 },
    { header: "Téléphone", key: "telephone", width: 16 },
    { header: "Statut", key: "statut", width: 12 },
    { header: "Date de départ", key: "depart", width: 14 },
    { header: "Payé", key: "paye", width: 13 },
    { header: "Articles/services dus", key: "articles_dus", width: 20 },
    { header: "Articles/services payés", key: "articles_payes", width: 22 },
    { header: "Arriéré", key: "arriere", width: 13 },
    { header: "Mois en retard", key: "retard", width: 14 },
    { header: "Reste année", key: "reste", width: 13 },
  ];
  // Paiements et articles groupés une fois par inscription (pas un parcours complet par élève)
  const paiementsParIns = new Map<string, typeof paiements>();
  for (const p of paiements) paiementsParIns.set(p.inscription_id, [...(paiementsParIns.get(p.inscription_id) ?? []), p]);
  const articlesParIns = new Map<string, typeof articles>();
  for (const a of articles) articlesParIns.set(a.inscription_id, [...(articlesParIns.get(a.inscription_id) ?? []), a]);

  for (const ins of inscriptions ?? []) {
    const e = eleveParId.get(ins.eleve_id);
    const parent = e?.parent_id ? parentParId.get(e.parent_id) : undefined;
    const s = situationInscription(ins, paiementsParIns.get(ins.id) ?? [], ecole, aujourdhui, articlesParIns.get(ins.id) ?? []);
    soldes.addRow({
      matricule: celluleTexte(e?.matricule),
      eleve: celluleTexte(e ? `${e.prenom} ${e.nom}` : ""),
      classe: celluleTexte(classeParId.get(ins.classe_id)),
      parent: celluleTexte(parent?.nom),
      telephone: celluleTexte(parent?.telephone),
      statut: LIBELLE_STATUT_INSCRIPTION[ins.statut],
      depart: ins.date_depart ?? "",
      paye: s.totalPaye,
      articles_dus: s.articles.reduce((t, a) => t + a.du, 0),
      articles_payes: s.articles.reduce((t, a) => t + a.paye, 0),
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
