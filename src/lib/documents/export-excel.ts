// Classeurs Excel (côté serveur) : export de l'année d'une école et export des écoles de la console SuperAdmin.
// Ne lit rien : la route ou l'action lit la base (session, RLS) et passe les lignes ; les textes libres sont neutralisés.
import ExcelJS from "exceljs";
import { celluleTexte } from "@/lib/documents/export-sur";
import { LIBELLE_MODE, LIBELLE_STATUT_INSCRIPTION, libellePaiement } from "@/lib/metier/libelles";
import { estRecuDeReprise } from "@/lib/metier/reprise-recu";
import { situationInscription } from "@/lib/metier/scolarite";
import { ENTETES_EXPORT_ADMIN, lignesExportAdmin } from "@/lib/metier/admin-ecoles";
import type { Classe, Eleve, Inscription, Paiement, Parent } from "@/types/database";
import type { EcoleAdmin } from "@/types/admin";
import type { ArticleCalcul, CalendrierEcole } from "@/types/commun";

export const TYPE_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export interface DonneesExportEcole {
  ecole: CalendrierEcole;
  aujourdhui: string;
  inscriptions: Pick<
    Inscription,
    | "id"
    | "eleve_id"
    | "classe_id"
    | "annee_scolaire"
    | "frais_inscription"
    | "mensualite"
    | "mensualite_dernier_mois"
    | "reduction_mensuelle"
    | "statut"
    | "date_depart"
  >[];
  eleves: Pick<Eleve, "id" | "matricule" | "prenom" | "nom" | "parent_id">[];
  classes: Pick<Classe, "id" | "nom">[];
  parents: Pick<Parent, "id" | "nom" | "telephone">[];
  /** Dans l'ordre du journal (date puis numéro de reçu) */
  paiements: Pick<
    Paiement,
    | "id"
    | "inscription_id"
    | "numero_recu"
    | "type"
    | "mois"
    | "montant"
    | "mode"
    | "reference"
    | "libelle"
    | "paye_le"
    | "annule"
    | "motif_annulation"
    | "article_id"
    | "encaisse_par"
  >[];
  articles: (ArticleCalcul & { inscription_id: string })[];
}

/** En-tête en gras blanc sur le vert de la marque, figée en haut */
function styliserEntete(feuille: ExcelJS.Worksheet) {
  feuille.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  feuille.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF059669" } };
  feuille.views = [{ state: "frozen", ySplit: 1 }];
}

/** Export de l'année d'une école : journal des paiements + état des soldes par élève */
export async function classeurEcole(d: DonneesExportEcole): Promise<ArrayBuffer> {
  const eleveParId = new Map(d.eleves.map((e) => [e.id, e]));
  const classeParId = new Map(d.classes.map((c) => [c.id, c.nom]));
  const parentParId = new Map(d.parents.map((p) => [p.id, p]));
  const insParId = new Map(d.inscriptions.map((i) => [i.id, i]));

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
  for (const p of d.paiements) {
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
  const paiementsParIns = new Map<string, DonneesExportEcole["paiements"]>();
  for (const p of d.paiements) paiementsParIns.set(p.inscription_id, [...(paiementsParIns.get(p.inscription_id) ?? []), p]);
  const articlesParIns = new Map<string, DonneesExportEcole["articles"]>();
  for (const a of d.articles) articlesParIns.set(a.inscription_id, [...(articlesParIns.get(a.inscription_id) ?? []), a]);

  for (const ins of d.inscriptions) {
    const e = eleveParId.get(ins.eleve_id);
    const parent = e?.parent_id ? parentParId.get(e.parent_id) : undefined;
    const s = situationInscription(ins, paiementsParIns.get(ins.id) ?? [], d.ecole, d.aujourdhui, articlesParIns.get(ins.id) ?? []);
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

  styliserEntete(journal);
  styliserEntete(soldes);
  return (await classeur.xlsx.writeBuffer()) as ArrayBuffer;
}

/** Export de la console SuperAdmin : une ligne par école */
export async function classeurAdmin(ecoles: EcoleAdmin[]): Promise<ArrayBuffer> {
  const classeur = new ExcelJS.Workbook();
  const feuille = classeur.addWorksheet("Écoles");
  feuille.addRow([...ENTETES_EXPORT_ADMIN]).font = { bold: true };
  for (const ligne of lignesExportAdmin(ecoles)) feuille.addRow(ligne);
  feuille.columns.forEach((c) => (c.width = 18));
  return (await classeur.xlsx.writeBuffer()) as ArrayBuffer;
}
