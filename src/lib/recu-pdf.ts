import "server-only";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { formatDate } from "@/lib/dates";
import { LIBELLE_MODE, libellePaiement } from "@/lib/libelles";
import { ENCAISSE_PAR_REPRISE, SOUS_TITRE_REPRISE } from "@/lib/reprise-recu";
import type { ModePaiement, Paiement } from "@/types/database";

export interface DonneesRecu {
  ecole: { nom: string; ville: string | null; adresse: string | null; telephone_contact: string | null };
  numero: string | null;
  payeLe: string;
  mode: ModePaiement;
  reference: string | null;
  annule: boolean;
  /** Reçu de « Reprise de l'existant » (versements antérieurs à FayJàng) */
  reprise?: boolean;
  /** Lignes du reçu (une mensualité, plusieurs mois, mensualité + tranche du dernier mois...) */
  lignes: Array<Pick<Paiement, "type" | "mois" | "libelle" | "montant" | "annule">>;
  eleve: { prenom: string; nom: string; matricule: string };
  classe: string;
  anneeScolaire: string;
}

/** pdf-lib (polices standard WinAnsi) : pas d'espace insécable ; les signes typographiques hors Latin-1 sont remplacés */
export function texte(valeur: string): string {
  return valeur
    .replace(/[\u00A0\u202F\u2009]/g, " ")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[^\x20-\x7E\xA1-\xFF]/g, "");
}

function montant(n: number): string {
  return `${new Intl.NumberFormat("fr-FR").format(n)} FCFA`.replace(/[\u00A0\u202F\u2009]/g, " ");
}

/** Place minimale gardée sous la dernière ligne pour le total et le cachet */
const BAS_TOTAL = 175;
/** Limite basse des lignes (au-dessus du pied de page) */
const BAS_LIGNES = 60;

/** Au-delà, le détail est coupé et le reste regroupé en une ligne : le total reste exact */
export const MAX_LIGNES_RECU = 300;

/** Coupe un texte trop large pour sa colonne et le termine par « ... » */
export function couper(t: string, largeur: number, mesurer: (s: string) => number): string {
  const propre = texte(t);
  if (mesurer(propre) <= largeur) return propre;
  let coupe = propre;
  while (coupe.length > 0 && mesurer(`${coupe}...`) > largeur) coupe = coupe.slice(0, -1);
  return `${coupe.trimEnd()}...`;
}

/** Reçu de paiement A5. Un reçu long passe sur plusieurs pages, sans jamais couper une ligne. */
export async function genererRecuPdf(d: DonneesRecu): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const gras = await doc.embedFont(StandardFonts.HelveticaBold);
  const vert = rgb(0.02, 0.59, 0.41);
  const gris = rgb(0.4, 0.4, 0.4);
  const noir = rgb(0, 0, 0);

  let page = doc.addPage([420, 595]);
  const droite = (t: string, x: number, y: number, size: number, font = gras, color = noir) =>
    page.drawText(texte(t), { x: x - font.widthOfTextAtSize(texte(t), size), y, size, font, color });

  /** Texte aligné à gauche, coupé pour ne pas dépasser `largeur` */
  const gauche = (t: string, x: number, y: number, size: number, largeur: number, font = normal, color = noir) =>
    page.drawText(couper(t, largeur, (s) => font.widthOfTextAtSize(s, size)), { x, y, size, font, color });

  const bandeau = (titre: string) => {
    page.drawRectangle({ x: 0, y: 565, width: 420, height: 30, color: vert });
    page.drawText(texte(titre), { x: 24, y: 575, size: 11, font: gras, color: rgb(1, 1, 1) });
  };
  const enteteColonnes = (y: number) => {
    page.drawText("Objet", { x: 24, y, size: 9, font: gras, color: gris });
    droite("Montant", 396, y, 9, gras, gris);
  };

  bandeau("FayJàng - Reçu de paiement");

  let y = 535;
  gauche(d.ecole.nom, 24, y, 15, 372, gras);
  y -= 16;
  const coord = [d.ecole.adresse, d.ecole.ville, d.ecole.telephone_contact].filter(Boolean).join(" - ");
  if (coord) gauche(coord, 24, y, 9, 372, normal, gris);

  y -= 34;
  page.drawText(texte(`Reçu n° ${d.numero ?? "-"}`), { x: 24, y, size: 12, font: gras });
  droite(`Le ${formatDate(d.payeLe)}`, 396, y, 10, normal, gris);

  if (d.reprise) {
    y -= 16;
    page.drawText(texte(SOUS_TITRE_REPRISE), { x: 24, y, size: 9, font: gras, color: vert });
  }

  y -= 28;
  const info = (label: string, valeur: string) => {
    page.drawText(texte(label), { x: 24, y, size: 10, font: normal, color: gris });
    gauche(valeur, 150, y, 10, 246, gras);
    y -= 18;
  };
  info("Élève", `${d.eleve.prenom} ${d.eleve.nom}`);
  info("Matricule", d.eleve.matricule);
  info("Classe", `${d.classe} (${d.anneeScolaire})`);
  info("Mode de paiement", LIBELLE_MODE[d.mode] + (d.reference ? ` - réf. ${d.reference}` : ""));
  if (d.reprise) info("Encaissé par", ENCAISSE_PAR_REPRISE);

  // Détail des lignes
  y -= 10;
  page.drawLine({ start: { x: 24, y: y + 4 }, end: { x: 396, y: y + 4 }, thickness: 0.5, color: gris });
  y -= 12;
  enteteColonnes(y);
  y -= 16;
  const valides = d.lignes.filter((l) => !l.annule || d.annule);
  const affichees = valides.slice(0, MAX_LIGNES_RECU);
  const masquees = valides.slice(MAX_LIGNES_RECU);
  const detail = affichees.map((l) => ({ libelle: libellePaiement(l), montant: l.montant }));
  if (masquees.length) {
    detail.push({ libelle: `Autres lignes (${masquees.length})`, montant: masquees.reduce((s, l) => s + l.montant, 0) });
  }
  for (const l of detail) {
    if (y < BAS_LIGNES) {
      page = doc.addPage([420, 595]);
      bandeau(`FayJàng - Reçu n° ${d.numero ?? "-"} (suite)`);
      y = 535;
      enteteColonnes(y);
      y -= 16;
    }
    const prix = montant(l.montant);
    // Le libellé s'arrête 12 pt avant le montant, aligné à droite
    gauche(l.libelle, 24, y, 10, 372 - normal.widthOfTextAtSize(prix, 10) - 12);
    droite(prix, 396, y, 10, normal);
    y -= 16;
  }
  page.drawLine({ start: { x: 24, y: y + 8 }, end: { x: 396, y: y + 8 }, thickness: 0.5, color: gris });

  y -= 22;
  if (y < BAS_TOTAL) {
    // Le total et le cachet ne chevauchent jamais les lignes : ils passent sur une page à eux
    page = doc.addPage([420, 595]);
    bandeau(`FayJàng - Reçu n° ${d.numero ?? "-"} (suite)`);
    y = 520;
  }
  const total = valides.reduce((s, l) => s + l.montant, 0);
  page.drawRectangle({ x: 24, y: y - 12, width: 372, height: 36, color: rgb(0.93, 0.99, 0.96), borderColor: vert, borderWidth: 1 });
  page.drawText(valides.length > 1 ? "Total reçu" : "Montant reçu", { x: 36, y: y + 2, size: 11, font: normal });
  droite(montant(total), 384, y + 1, 15, gras, vert);

  page.drawText(texte("Cachet et signature de l'administration"), { x: 200, y: 110, size: 9, font: normal, color: gris });

  const pages = doc.getPages();
  pages.forEach((p, i) => {
    if (d.annule) {
      p.drawText("ANNULÉ", { x: 110, y: 230, size: 64, font: gras, color: rgb(0.86, 0.15, 0.15), opacity: 0.35 });
    }
    p.drawText(texte("Reçu généré par FayJàng - conservez-le comme justificatif."), { x: 24, y: 30, size: 8, font: normal, color: gris });
    if (pages.length > 1) {
      const t = `Page ${i + 1}/${pages.length}`;
      p.drawText(t, { x: 396 - normal.widthOfTextAtSize(t, 8), y: 30, size: 8, font: normal, color: gris });
    }
  });

  return doc.save();
}
