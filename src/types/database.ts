/** Types des tables Supabase (à tenir à jour avec supabase/schema.sql) */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type PlanId = "essai" | "standard" | "premium";
export type StatutAbonnement = "essai" | "actif" | "expire" | "suspendu";
export type Niveau = "prescolaire" | "elementaire" | "moyen" | "secondaire";
export type StatutInscription = "active" | "abandon" | "transfert";
export type TypePaiement = "inscription" | "mensualite" | "autre";
export type ModePaiement = "especes" | "wave" | "orange_money" | "free_money" | "virement" | "cheque";

/** Row complet ; Insert = colonnes obligatoires + optionnelles ; Update = tout optionnel */
type Table<Row, Requis extends keyof Row> = {
  Row: Row;
  Insert: Pick<Row, Requis> & Partial<Omit<Row, Requis>>;
  Update: Partial<Row>;
  Relationships: [];
};

export type Ecole = {
  id: string;
  nom: string;
  slug: string;
  ville: string | null;
  adresse: string | null;
  responsable_nom: string | null;
  email_contact: string | null;
  telephone_contact: string | null;
  annee_scolaire: string;
  mois_debut: number;
  nb_mensualites: number;
  jour_echeance: number;
  /** Tranches activées (nom historique) : le mois ciblé par rang_mois_tranches se paie par tranches à partir de mois_debut_tranches (1-12) */
  tranches_dernier_mois: boolean;
  mois_debut_tranches: number | null;
  /** Nombre de tranches ; null = autant de mois que possible avant le mois ciblé */
  nb_tranches: number | null;
  /** Mois payé par tranches, compté depuis la fin : 1 = dernier, 2 = avant-dernier, 3 = antépénultième */
  rang_mois_tranches: number;
  /** Mensualités exigibles dès l'inscription (payées d'avance) */
  premier_mois_a_linscription: boolean;
  dernier_mois_a_linscription: boolean;
  plan: PlanId;
  statut_abonnement: StatutAbonnement;
  trial_ends_at: string | null;
  abonnement_fin: string | null;
  is_active: boolean;
  created_at: string;
}

export type AccesEcole = {
  ecole_id: string;
  code_hash: string;
  updated_at: string;
}

export type Classe = {
  id: string;
  ecole_id: string;
  nom: string;
  niveau: Niveau;
  annee_scolaire: string;
  frais_inscription: number;
  mensualite: number;
  /** Mensualité du dernier mois ; null = mensualité ordinaire */
  mensualite_dernier_mois: number | null;
  is_active: boolean;
  created_at: string;
}

export type Parent = {
  id: string;
  ecole_id: string;
  nom: string;
  telephone: string;
  token: string;
  is_active: boolean;
  created_at: string;
}

export type Eleve = {
  id: string;
  ecole_id: string;
  parent_id: string | null;
  matricule: string;
  prenom: string;
  nom: string;
  sexe: "M" | "F" | null;
  date_naissance: string | null;
  is_active: boolean;
  created_at: string;
}

export type Inscription = {
  id: string;
  ecole_id: string;
  eleve_id: string;
  classe_id: string;
  annee_scolaire: string;
  frais_inscription: number;
  mensualite: number;
  mensualite_dernier_mois: number | null;
  reduction_mensuelle: number;
  statut: StatutInscription;
  /** Date de départ (abandon, transfert) ; null pour une inscription active */
  date_depart: string | null;
  created_at: string;
}

export type Paiement = {
  id: string;
  ecole_id: string;
  inscription_id: string;
  type: TypePaiement;
  mois: string | null; // YYYY-MM-01
  montant: number;
  mode: ModePaiement;
  reference: string | null;
  libelle: string | null;
  numero_recu: string | null;
  /** Lignes encaissées ensemble : même lot = même reçu */
  lot_id: string | null;
  /** Paiement d'un article (tenue, transport…) : ligne d'articles_inscription */
  article_id: string | null;
  paye_le: string; // YYYY-MM-DD
  encaisse_par: string | null;
  annule: boolean;
  motif_annulation: string | null;
  annule_at: string | null;
  created_at: string;
}

export type NatureArticle = "unique" | "mensuel";

/** Catalogue d'une classe : frais uniques (tenue, blouson) ou services mensuels (transport, pensionnat) */
export type ArticleClasse = {
  id: string;
  ecole_id: string;
  classe_id: string;
  libelle: string;
  nature: NatureArticle;
  prix_unitaire: number;
  quantite_defaut: number;
  obligatoire: boolean;
  ordre: number;
  created_at: string;
}

/** Copie figée d'un article pour un élève (quantité choisie, période du service) */
export type ArticleInscription = {
  id: string;
  ecole_id: string;
  inscription_id: string;
  article_classe_id: string | null;
  libelle: string;
  nature: NatureArticle;
  prix_unitaire: number;
  quantite: number;
  obligatoire: boolean;
  mois_debut: string | null;
  mois_fin: string | null;
  created_at: string;
}

export type Database = {
  public: {
    Tables: {
      ecoles: Table<Ecole, "nom" | "slug">;
      acces_ecole: Table<AccesEcole, "ecole_id" | "code_hash">;
      classes: Table<Classe, "ecole_id" | "nom" | "annee_scolaire">;
      parents: Table<Parent, "ecole_id" | "nom" | "telephone">;
      eleves: Table<Eleve, "ecole_id" | "matricule" | "prenom" | "nom">;
      inscriptions: Table<
        Inscription,
        "ecole_id" | "eleve_id" | "classe_id" | "annee_scolaire" | "frais_inscription" | "mensualite"
      >;
      paiements: Table<Paiement, "ecole_id" | "inscription_id" | "type" | "montant" | "mode">;
      articles_classe: Table<ArticleClasse, "ecole_id" | "classe_id" | "libelle" | "nature" | "prix_unitaire">;
      articles_inscription: Table<ArticleInscription, "ecole_id" | "inscription_id" | "libelle" | "nature" | "prix_unitaire">;
    };
    Views: { [_ in never]: never };
    Functions: {
      /** Inscription atomique (supabase/schema/05-migrations.sql, bloc v1.7) ; retour : voir ResultatInscription */
      inscrire_eleve: {
        Args: {
          p_classe_id: string;
          p_eleve_id?: string | null;
          p_prenom?: string | null;
          p_nom?: string | null;
          p_sexe?: string | null;
          p_date_naissance?: string | null;
          p_parent_nom?: string | null;
          p_parent_telephone?: string | null;
          p_reduction?: number;
          p_articles?: Json;
          p_mois_debut_services?: string | null;
          p_mode?: string | null;
          p_reference?: string | null;
          p_lignes_paiement?: Json;
        };
        Returns: Json;
      };
      /** Encaissement atomique (supabase/schema/05-migrations.sql, bloc v1.8) ; retour : voir ResultatEncaissement (src/lib/encaissement.ts) */
      encaisser_paiement: {
        Args: {
          p_inscription_id: string;
          p_lot_id: string;
          p_mode: string;
          p_reference: string | null;
          p_lignes: Json;
          p_nb_paiements: number;
          p_total_actif: number;
        };
        Returns: Json;
      };
      /** Classe + catalogue en une transaction (supabase/schema/05-migrations.sql, bloc v1.9) ;
       * retour : { classe_id, creee, nb_articles }. p_articles null = catalogue non touché */
      enregistrer_classe: {
        Args: {
          p_classe_id?: string | null;
          p_nom?: string | null;
          p_niveau?: string | null;
          p_frais_inscription?: number | null;
          p_mensualite?: number | null;
          p_mensualite_dernier_mois?: number | null;
          p_articles?: Json | null;
        };
        Returns: Json;
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
}
