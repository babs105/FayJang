/** Montant en clair pour les messages de l'Espace École : « 25 000 FCFA » */
export const fcfa = (n: number) => `${new Intl.NumberFormat("fr-FR").format(n)} FCFA`;
