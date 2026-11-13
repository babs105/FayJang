// Types de la page parent (/parent/[token]) : ce que le parent voit de chaque enfant.

/** Service mensuel d'un enfant, cumulé sur l'année (une ligne par service, pas par mois) */
export type ServiceParent = { libelle: string; du: number; paye: number; resteEchu: number };

/** Paramètres des routes du lien magique parent */
export type ParamsParent = { token: string };
