import { formatFCFA } from "@/lib/utils";

/**
 * Relances WhatsApp : liens wa.me ouverts par l'école (mode manuel, comme Cantine Pro).
 * Le numéro est au format E.164 (+221...) ; wa.me attend les chiffres seuls.
 */
export function lienWhatsApp(telephone: string, message: string): string {
  return `https://wa.me/${telephone.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`;
}

export function messageRelance(p: {
  ecole: string;
  parent: string;
  eleve: string;
  arriere: number;
  moisEnRetard: number;
  lienParent: string;
}): string {
  const detail = p.moisEnRetard > 0 ? ` (${p.moisEnRetard} mois en retard)` : "";
  return (
    `Bonjour ${p.parent},\n` +
    `${p.ecole} vous rappelle que la scolarité de ${p.eleve} présente un reste à payer de ${formatFCFA(p.arriere)}${detail}.\n` +
    `Détail et reçus : ${p.lienParent}\n` +
    `Merci de régulariser auprès de l'administration. Jërëjëf !`
  );
}

export function messageLienParent(p: { ecole: string; parent: string; lienParent: string }): string {
  return (
    `Bonjour ${p.parent},\n` +
    `${p.ecole} utilise JàngPay pour le suivi de la scolarité.\n` +
    `Consultez à tout moment les paiements et reçus de vos enfants : ${p.lienParent}`
  );
}
