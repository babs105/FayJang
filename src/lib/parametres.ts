// Paramètres de l'école : lecture du retour de enregistrer_parametres (supabase/schema/05-migrations.sql, bloc v1.11)
// et message affiché à l'administration.

export type ResultatParametres = {
  annee_changee: boolean;
  classes_copiees: number;
  articles_copies: number;
  classes_deja_presentes: number;
};

const entier = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : 0);

/** Retour de la fonction SQL ; valeurs manquantes ou mal formées = 0 / false */
export function lireResultatParametres(data: unknown): ResultatParametres {
  const d = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  return {
    annee_changee: d.annee_changee === true,
    classes_copiees: entier(d.classes_copiees),
    articles_copies: entier(d.articles_copies),
    classes_deja_presentes: entier(d.classes_deja_presentes),
  };
}

/** Message de succès : classes reprises pour la nouvelle année, ou année déjà préparée */
export function messageParametres(r: ResultatParametres, annee: string): string {
  if (r.classes_copiees > 0) {
    const classes = r.classes_copiees > 1 ? `${r.classes_copiees} classes reprises` : "1 classe reprise";
    return `Paramètres enregistrés. ${classes} pour ${annee} : réinscrivez les élèves.`;
  }
  if (r.annee_changee && r.classes_deja_presentes > 0) {
    return `Paramètres enregistrés. Les classes de ${annee} existent déjà : rien n'a été copié.`;
  }
  return "Paramètres enregistrés.";
}
