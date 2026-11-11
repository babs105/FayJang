// Texte libre écrit dans un export Excel : une valeur qui commence par =, +, -, @, une tabulation ou un retour chariot
// peut être prise pour une formule par un tableur (nom saisi à la main, ou venu d'un fichier importé). On la préfixe
// d'une apostrophe pour qu'elle reste du texte. Un téléphone normalisé (+221…) n'est pas une formule : laissé tel quel.

const DEBUT_FORMULE = /^[=+\-@\t\r]/;
const TELEPHONE = /^\+\d{6,15}$/;

export function celluleTexte(valeur: string | null | undefined): string {
  if (!valeur) return "";
  if (TELEPHONE.test(valeur)) return valeur;
  return DEBUT_FORMULE.test(valeur) ? `'${valeur}` : valeur;
}
