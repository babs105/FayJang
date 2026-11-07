import "server-only";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { formatDate } from "@/lib/dates";
import { LIBELLE_MODE, libellePaiement } from "@/lib/libelles";
import type { ModePaiement, Paiement } from "@/types/database";

export interface DonneesRecu {
  ecole: { nom: string; ville: string | null; adresse: string | null; telephone_contact: string | null };
  numero: string | null;
  payeLe: string;
  mode: ModePaiement;
  reference: string | null;
  annule: boolean;
  /** Lignes du reçu (une mensualité, plusieurs mois, mensualité + tranche du dernier mois...) */
  lignes: Array<Pick<Paiement, "type" | "mois" | "libelle" | "montant" | "annule">>;
  eleve: { prenom: string; nom: string; matricule: string };
  classe: string;
  anneeScolaire: string;
}

/** pdf-lib (polices standard WinAnsi) : pas d'espace insécable ni de caractères hors Latin-1 */
function texte(valeur: string): string {
  return valeur.replace(/[  ]/g, " ").replace(/[^\x20-\xFF]/g, "");
}

function montant(n: number): string {
  return `${new Intl.NumberFormat("fr-FR").format(n).replace(/[  ]/g, " ")} FCFA`;
}

/** Reçu de paiement A5 */
export async function genererRecuPdf(d: DonneesRecu): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([420, 595]);
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const gras = await doc.embedFont(StandardFonts.HelveticaBold);
  const vert = rgb(0.02, 0.59, 0.41);
  const gris = rgb(0.4, 0.4, 0.4);
  const droite = (t: string, x: number, y: number, size: number, font = gras, color = rgb(0, 0, 0)) =>
    page.drawText(texte(t), { x: x - font.widthOfTextAtSize(texte(t), size), y, size, font, color });

  page.drawRectangle({ x: 0, y: 565, width: 420, height: 30, color: vert });
  page.drawText("JangPay - Recu de paiement", { x: 24, y: 575, size: 11, font: gras, color: rgb(1, 1, 1) });

  let y = 535;
  page.drawText(texte(d.ecole.nom), { x: 24, y, size: 15, font: gras });
  y -= 16;
  const coord = [d.ecole.adresse, d.ecole.ville, d.ecole.telephone_contact].filter(Boolean).join(" - ");
  if (coord) page.drawText(texte(coord), { x: 24, y, size: 9, font: normal, color: gris });

  y -= 34;
  page.drawText(texte(`Recu n° ${d.numero ?? "-"}`), { x: 24, y, size: 12, font: gras });
  droite(`Le ${formatDate(d.payeLe)}`, 396, y, 10, normal, gris);

  y -= 28;
  const info = (label: string, valeur: string) => {
    page.drawText(texte(label), { x: 24, y, size: 10, font: normal, color: gris });
    page.drawText(texte(valeur), { x: 150, y, size: 10, font: gras });
    y -= 18;
  };
  info("Élève", `${d.eleve.prenom} ${d.eleve.nom}`);
  info("Matricule", d.eleve.matricule);
  info("Classe", `${d.classe} (${d.anneeScolaire})`);
  info("Mode de paiement", LIBELLE_MODE[d.mode] + (d.reference ? ` - réf. ${d.reference}` : ""));

  // Détail des lignes
  y -= 10;
  page.drawLine({ start: { x: 24, y: y + 4 }, end: { x: 396, y: y + 4 }, thickness: 0.5, color: gris });
  y -= 12;
  page.drawText("Objet", { x: 24, y, size: 9, font: gras, color: gris });
  droite("Montant", 396, y, 9, gras, gris);
  y -= 16;
  const valides = d.lignes.filter((l) => !l.annule || d.annule);
  for (const l of valides) {
    page.drawText(texte(libellePaiement(l)), { x: 24, y, size: 10, font: normal });
    droite(montant(l.montant), 396, y, 10, normal);
    y -= 16;
  }
  page.drawLine({ start: { x: 24, y: y + 8 }, end: { x: 396, y: y + 8 }, thickness: 0.5, color: gris });

  y -= 22;
  const total = valides.reduce((s, l) => s + l.montant, 0);
  page.drawRectangle({ x: 24, y: y - 12, width: 372, height: 36, color: rgb(0.93, 0.99, 0.96), borderColor: vert, borderWidth: 1 });
  page.drawText(valides.length > 1 ? "Total reçu" : "Montant reçu", { x: 36, y: y + 2, size: 11, font: normal });
  droite(montant(total), 384, y + 1, 15, gras, vert);

  if (d.annule) {
    page.drawText("ANNULÉ", { x: 110, y: 230, size: 64, font: gras, color: rgb(0.86, 0.15, 0.15), opacity: 0.35 });
  }

  page.drawText(texte("Cachet et signature de l'administration"), { x: 200, y: 110, size: 9, font: normal, color: gris });
  page.drawText(texte("Reçu généré par JàngPay - conservez-le comme justificatif."), { x: 24, y: 30, size: 8, font: normal, color: gris });

  return doc.save();
}
