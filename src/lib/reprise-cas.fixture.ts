// Cas de référence de la reprise de l'existant : les élèves de la feuille « Cas d'exemple » du modèle
// (public/modele-import-ecole.xlsx), traduits en entrées et en résultats attendus.
// Import le 11/11/2026, année 2026-2027 d'octobre à juin (9 mensualités), échéance le 5.
// Les montants attendus ont été calculés à la main d'après situationInscription (src/lib/scolarite.ts) :
// si un test les contredit, signaler l'écart (la feuille a été validée par l'humain), ne pas les modifier en silence.

export interface ReglagesCas {
  mois_debut: number;
  nb_mensualites: number;
  jour_echeance: number;
  tranches_dernier_mois: boolean;
  mois_debut_tranches: number | null;
  nb_tranches: number | null;
  rang_mois_tranches: number;
  premier_mois_a_linscription: boolean;
  dernier_mois_a_linscription: boolean;
}

export interface ArticleCatalogueCas {
  libelle: string;
  nature: "unique" | "mensuel";
  prix_unitaire: number;
  quantite_defaut: number;
  obligatoire: boolean;
  /** Ordre dans le catalogue de la classe */
  ordre: number;
}

export interface PaiementAttendu {
  type: "inscription" | "mensualite" | "autre";
  /** AAAA-MM-01 pour une mensualité ou un mois de service */
  mois: string | null;
  /** Libellé de l'article pour le type « autre » */
  article: string | null;
  montant: number;
}

export interface CasReprise {
  nom: string;
  description: string;
  annee: string;
  aujourdhui: string;
  reglages: ReglagesCas;
  classe: { nom: string; frais_inscription: number; mensualite: number; mensualite_dernier_mois: number | null };
  catalogue: ArticleCatalogueCas[];
  eleve: {
    totalScolarite: number | null;
    totalArticles: number | null;
    reduction: number | null;
    statut: "active" | "abandon" | "transfert";
    dateDepart: string | null;
    /**
     * Options choisies ; quantite null = quantité par défaut ; debut = premier mois dû d'un service mensuel donné par
     * le fichier (colonne « Début des options » ou « Cantine (03/2027) »), absent ou null = règle par défaut
     */
    options: { libelle: string; quantite: number | null; debut?: string | null }[];
  };
  attendu:
    | { erreur: string }
    | {
        /** Paiements produits, dans n'importe quel ordre (les tranches d'un mois sont cumulées sur une ligne) */
        paiements: PaiementAttendu[];
        /** Premier mois dû de chaque service mensuel retenu */
        debutServices: Record<string, string>;
        arriere: number;
        resteAnnee: number;
      };
}

const SANS_REGLAGE: ReglagesCas = {
  mois_debut: 10,
  nb_mensualites: 9,
  jour_echeance: 5,
  tranches_dernier_mois: false,
  mois_debut_tranches: null,
  nb_tranches: null,
  rang_mois_tranches: 1,
  premier_mois_a_linscription: false,
  dernier_mois_a_linscription: false,
};

/** Juin payé à l'inscription, mai (avant-dernier mois) en 3 tranches dues les 5 janvier, février et mars */
const JUIN_A_LINSCRIPTION_MAI_EN_TRANCHES: ReglagesCas = {
  ...SANS_REGLAGE,
  dernier_mois_a_linscription: true,
  tranches_dernier_mois: true,
  rang_mois_tranches: 2,
  mois_debut_tranches: 1,
  nb_tranches: 3,
};

const BASE = { annee: "2026-2027", aujourdhui: "2026-11-11" };

const CM2A = { nom: "CM2 A", frais_inscription: 25000, mensualite: 15000, mensualite_dernier_mois: null };
const CATALOGUE_CM2A: ArticleCatalogueCas[] = [
  { libelle: "Tenue", nature: "unique", prix_unitaire: 8000, quantite_defaut: 2, obligatoire: true, ordre: 0 },
  { libelle: "Transport", nature: "mensuel", prix_unitaire: 5000, quantite_defaut: 1, obligatoire: false, ordre: 1 },
  { libelle: "Cantine", nature: "mensuel", prix_unitaire: 10000, quantite_defaut: 1, obligatoire: false, ordre: 2 },
  { libelle: "Étude du soir", nature: "mensuel", prix_unitaire: 3000, quantite_defaut: 1, obligatoire: false, ordre: 3 },
];
const CE1 = { nom: "CE1", frais_inscription: 20000, mensualite: 12000, mensualite_dernier_mois: 6000 };
const CATALOGUE_CE1: ArticleCatalogueCas[] = [
  { libelle: "Tenue", nature: "unique", prix_unitaire: 7000, quantite_defaut: 1, obligatoire: true, ordre: 0 },
  { libelle: "Assurance", nature: "unique", prix_unitaire: 2000, quantite_defaut: 1, obligatoire: true, ordre: 1 },
  { libelle: "Transport", nature: "mensuel", prix_unitaire: 5000, quantite_defaut: 1, obligatoire: false, ordre: 2 },
];

const ACTIF = { reduction: null, statut: "active" as const, dateDepart: null };
const m = (mois: string, montant: number): PaiementAttendu => ({ type: "mensualite", mois: `${mois}-01`, article: null, montant });
const ins = (montant: number): PaiementAttendu => ({ type: "inscription", mois: null, article: null, montant });
const art = (article: string, montant: number, mois: string | null = null): PaiementAttendu => ({
  type: "autre",
  mois: mois ? `${mois}-01` : null,
  article,
  montant,
});

export const CAS_REPRISE: CasReprise[] = [
  {
    nom: "Awa Diop",
    description: "À jour puis partiel ; options Transport et Cantine ; Tenue obligatoire ×2",
    ...BASE,
    reglages: SANS_REGLAGE,
    classe: CM2A,
    catalogue: CATALOGUE_CM2A,
    eleve: { ...ACTIF, totalScolarite: 62000, totalArticles: 42000, options: [{ libelle: "Transport", quantite: null }, { libelle: "Cantine", quantite: null }] },
    attendu: {
      paiements: [
        ins(25000), m("2026-10", 15000), m("2026-11", 15000), m("2026-12", 7000),
        art("Tenue", 16000),
        art("Transport", 5000, "2026-10"), art("Cantine", 10000, "2026-10"),
        art("Transport", 5000, "2026-11"), art("Cantine", 6000, "2026-11"),
      ],
      debutServices: { Transport: "2026-10-01", Cantine: "2026-10-01" },
      // Cantine de novembre : 4 000 restants, échue le 5/11
      arriere: 4000,
      // Scolarité 98 000 (déc. 8 000 + janv.-juin 90 000) + Transport 35 000 + Cantine 74 000
      resteAnnee: 207000,
    },
  },
  {
    nom: "Ibrahima Diop",
    description: "Réduction de 2 000 (mensualité nette 10 000, dernier mois 4 000) ; novembre impayé",
    ...BASE,
    reglages: SANS_REGLAGE,
    classe: CE1,
    catalogue: CATALOGUE_CE1,
    eleve: { ...ACTIF, reduction: 2000, totalScolarite: 30000, totalArticles: 9000, options: [] },
    attendu: {
      paiements: [ins(20000), m("2026-10", 10000), art("Tenue", 7000), art("Assurance", 2000)],
      debutServices: {},
      arriere: 10000,
      // Novembre à mai 7 × 10 000 + juin 4 000
      resteAnnee: 74000,
    },
  },
  {
    nom: "Fatou Ndiaye",
    description: "Abandon le 05/11/2026 ; inscription à moitié payée ; articles obligatoires impayés",
    ...BASE,
    reglages: SANS_REGLAGE,
    classe: CE1,
    catalogue: CATALOGUE_CE1,
    eleve: { totalScolarite: 10000, totalArticles: null, reduction: null, statut: "abandon", dateDepart: "2026-11-05", options: [] },
    attendu: {
      paiements: [ins(10000)],
      debutServices: {},
      // Inscription 10 000 + octobre et novembre (mois du départ) 24 000 + tenue et assurance 9 000
      arriere: 43000,
      resteAnnee: 43000,
    },
  },
  {
    nom: "Moussa Fall",
    description: "Transfert le 31/10/2026, payé jusqu'au départ",
    ...BASE,
    reglages: SANS_REGLAGE,
    classe: { nom: "6e A", frais_inscription: 30000, mensualite: 20000, mensualite_dernier_mois: null },
    catalogue: [{ libelle: "Fournitures", nature: "unique", prix_unitaire: 15000, quantite_defaut: 1, obligatoire: true, ordre: 0 }],
    eleve: { totalScolarite: 50000, totalArticles: 15000, reduction: null, statut: "transfert", dateDepart: "2026-10-31", options: [] },
    attendu: { paiements: [ins(30000), m("2026-10", 20000), art("Fournitures", 15000)], debutServices: {}, arriere: 0, resteAnnee: 0 },
  },
  {
    nom: "Khady Sarr",
    description: "Aucun versement ; option Goûter (service mensuel jamais payé)",
    ...BASE,
    reglages: SANS_REGLAGE,
    classe: { nom: "Petite section", frais_inscription: 15000, mensualite: 10000, mensualite_dernier_mois: null },
    catalogue: [{ libelle: "Goûter", nature: "mensuel", prix_unitaire: 4000, quantite_defaut: 1, obligatoire: false, ordre: 0 }],
    eleve: { ...ACTIF, totalScolarite: null, totalArticles: null, options: [{ libelle: "Goûter", quantite: null }] },
    attendu: {
      paiements: [],
      // Sans argent reçu, le service est dû à partir du mois de l'import
      debutServices: { "Goûter": "2026-11-01" },
      // Inscription 15 000 + octobre et novembre 20 000 + goûter de novembre 4 000
      arriere: 39000,
      // Scolarité 105 000 + goûter novembre à juin 32 000
      resteAnnee: 137000,
    },
  },
  {
    nom: "Ndeye Gueye",
    description: "Année entière payée d'avance",
    ...BASE,
    reglages: SANS_REGLAGE,
    classe: { nom: "Terminale S", frais_inscription: 40000, mensualite: 30000, mensualite_dernier_mois: null },
    catalogue: [],
    eleve: { ...ACTIF, totalScolarite: 310000, totalArticles: null, options: [] },
    attendu: {
      paiements: [
        ins(40000),
        ...["2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03", "2027-04", "2027-05", "2027-06"].map((x) => m(x, 30000)),
      ],
      debutServices: {},
      arriere: 0,
      resteAnnee: 0,
    },
  },
  {
    nom: "Mariama Ba",
    description: "Payé d'avance jusqu'à février ; Tenue obligatoire payée",
    ...BASE,
    reglages: SANS_REGLAGE,
    classe: CM2A,
    catalogue: CATALOGUE_CM2A,
    eleve: { ...ACTIF, totalScolarite: 100000, totalArticles: 16000, options: [] },
    attendu: {
      paiements: [
        ins(25000), m("2026-10", 15000), m("2026-11", 15000), m("2026-12", 15000), m("2027-01", 15000), m("2027-02", 15000),
        art("Tenue", 16000),
      ],
      debutServices: {},
      arriere: 0,
      resteAnnee: 60000,
    },
  },
  {
    nom: "Cheikh Mbaye",
    description: "Trois options dont « Tenue x3 » (article obligatoire, quantité changée)",
    ...BASE,
    reglages: SANS_REGLAGE,
    classe: CM2A,
    catalogue: CATALOGUE_CM2A,
    eleve: {
      ...ACTIF,
      totalScolarite: 55000,
      totalArticles: 32000,
      options: [{ libelle: "Transport", quantite: null }, { libelle: "Étude du soir", quantite: null }, { libelle: "Tenue", quantite: 3 }],
    },
    attendu: {
      paiements: [
        ins(25000), m("2026-10", 15000), m("2026-11", 15000),
        art("Tenue", 24000), art("Transport", 5000, "2026-10"), art("Étude du soir", 3000, "2026-10"),
      ],
      debutServices: { Transport: "2026-10-01", "Étude du soir": "2026-10-01" },
      // Transport et étude de novembre
      arriere: 8000,
      // Scolarité 105 000 + transport 8 × 5 000 + étude 8 × 3 000
      resteAnnee: 169000,
    },
  },
  {
    nom: "Bineta Sy",
    description: "Transport pris en cours d'année : « Début des options » = 11/2026",
    ...BASE,
    reglages: SANS_REGLAGE,
    classe: CM2A,
    catalogue: CATALOGUE_CM2A,
    eleve: { ...ACTIF, totalScolarite: 55000, totalArticles: 21000, options: [{ libelle: "Transport", quantite: null, debut: "2026-11-01" }] },
    attendu: {
      paiements: [ins(25000), m("2026-10", 15000), m("2026-11", 15000), art("Tenue", 16000), art("Transport", 5000, "2026-11")],
      debutServices: { Transport: "2026-11-01" },
      arriere: 0,
      // Scolarité 105 000 + transport décembre à juin 35 000
      resteAnnee: 140000,
    },
  },
  {
    nom: "Transport depuis janvier, import en février",
    description: "Sans le mois de début, les 10 000 iraient sur octobre et novembre (15 000 d'arriéré fictif)",
    annee: "2026-2027",
    aujourdhui: "2027-02-11",
    reglages: SANS_REGLAGE,
    classe: CM2A,
    catalogue: [{ libelle: "Transport", nature: "mensuel", prix_unitaire: 5000, quantite_defaut: 1, obligatoire: false, ordre: 0 }],
    eleve: { ...ACTIF, totalScolarite: 100000, totalArticles: 10000, options: [{ libelle: "Transport", quantite: null, debut: "2027-01-01" }] },
    attendu: {
      paiements: [
        ins(25000), m("2026-10", 15000), m("2026-11", 15000), m("2026-12", 15000), m("2027-01", 15000), m("2027-02", 15000),
        art("Transport", 5000, "2027-01"), art("Transport", 5000, "2027-02"),
      ],
      debutServices: { Transport: "2027-01-01" },
      arriere: 0,
      // Scolarité mars à juin 60 000 + transport mars à juin 20 000
      resteAnnee: 80000,
    },
  },
  {
    nom: "Un service avec son propre mois",
    description: "« Transport ; Cantine (11/2026) » : transport par défaut (payé, donc depuis octobre), cantine depuis novembre",
    ...BASE,
    reglages: SANS_REGLAGE,
    classe: CM2A,
    catalogue: CATALOGUE_CM2A,
    eleve: {
      ...ACTIF,
      totalScolarite: 55000,
      totalArticles: 36000,
      options: [{ libelle: "Transport", quantite: null, debut: null }, { libelle: "Cantine", quantite: null, debut: "2026-11-01" }],
    },
    attendu: {
      paiements: [
        ins(25000), m("2026-10", 15000), m("2026-11", 15000),
        art("Tenue", 16000), art("Transport", 5000, "2026-10"), art("Transport", 5000, "2026-11"), art("Cantine", 10000, "2026-11"),
      ],
      debutServices: { Transport: "2026-10-01", Cantine: "2026-11-01" },
      arriere: 0,
      // Scolarité 105 000 + transport décembre à juin 35 000 + cantine décembre à juin 70 000
      resteAnnee: 210000,
    },
  },
  {
    nom: "Réglage spécial, 62 000 versés",
    description: "Juin à l'inscription + mai en 3 tranches (janv., févr., mars) ; classe sans catalogue",
    ...BASE,
    reglages: JUIN_A_LINSCRIPTION_MAI_EN_TRANCHES,
    classe: CM2A,
    catalogue: [],
    eleve: { ...ACTIF, totalScolarite: 62000, totalArticles: null, options: [] },
    attendu: {
      paiements: [ins(25000), m("2027-06", 15000), m("2026-10", 15000), m("2026-11", 7000)],
      debutServices: {},
      arriere: 8000,
      resteAnnee: 98000,
    },
  },
  {
    nom: "Réglage spécial, 130 000 versés",
    description: "Même réglage : la tranche de mai passe après la mensualité du même jour",
    ...BASE,
    reglages: JUIN_A_LINSCRIPTION_MAI_EN_TRANCHES,
    classe: CM2A,
    catalogue: [],
    eleve: { ...ACTIF, totalScolarite: 130000, totalArticles: null, options: [] },
    attendu: {
      // inscription, juin, oct., nov., déc., janv., tranche 1 de mai, févr., tranche 2 de mai, 5 000 sur mars
      paiements: [
        ins(25000), m("2027-06", 15000), m("2026-10", 15000), m("2026-11", 15000), m("2026-12", 15000), m("2027-01", 15000),
        m("2027-05", 10000), m("2027-02", 15000), m("2027-03", 5000),
      ],
      debutServices: {},
      arriere: 0,
      resteAnnee: 30000,
    },
  },
  {
    nom: "Total supérieur à l'année",
    description: "170 000 versés en CM2 A pour un total de l'année de 160 000",
    ...BASE,
    reglages: SANS_REGLAGE,
    classe: CM2A,
    catalogue: [],
    eleve: { ...ACTIF, totalScolarite: 170000, totalArticles: null, options: [] },
    attendu: { erreur: "dépasse" },
  },
];
