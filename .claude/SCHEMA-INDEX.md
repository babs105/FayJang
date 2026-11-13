# Index de schema.sql

> **Fichier généré automatiquement.** Ne pas éditer à la main.
> Régénérer : `bash scripts/schema-index.sh`

**Total : 4772 lignes.**

## Tables

- `acces_ecole` — L57
- `articles_classe` — L677
- `articles_inscription` — L692
- `classes` — L65
- `compteurs_recus` — L154
- `ecoles` — L32
- `eleves` — L94
- `inscriptions` — L111
- `paiements` — L129
- `parents` — L81
- `schema_migrations` — L25
- `tentatives_connexion` — L163
- `utilisateurs_ecole` — L3811

## Vues


## Fonctions

- `abonnement_ecole` — L3711
- `changer_code_ecole` — L344
- `changer_mon_mot_de_passe` — L3958
- `changer_statut_utilisateur` — L4728
- `code_correspond` — L244
- `controler_tentatives` — L186
- `creer_utilisateur_ecole` — L4688
- `echanger_acces_ecole` — L270
- `echanger_jeton_parent` — L332
- `echanger_utilisateur_ecole` — L3892
- `effacer_tentatives` — L227
- `encaisser_paiement` — L4045 **(active)** · remplace L1276, L2300
- `enregistrer_classe` — L1538
- `enregistrer_parametres` — L1973
- `exiger_directeur` — L4651
- `exiger_ecriture_ecole` — L3737
- `exiger_ecriture_parent` — L3746
- `hacher_code_bcrypt` — L257
- `hacher_mot_de_passe_utilisateur` — L3832
- `importer_reprise` — L3276 **(active)** · remplace L2583
- `inscrire_eleve` — L4329 **(active)** · remplace L994, L1693, L2980
- `interdire_suppression_paiement` — L3639
- `ip_pour_cle` — L237
- `jwt_ecole_id` — L179
- `jwt_parent_id` — L182
- `jwt_role_app` — L176
- `jwt_role_utilisateur` — L3887
- `jwt_utilisateur_id` — L3884
- `lister_utilisateurs_ecole` — L4671
- `nom_utilisateur_courant` — L4035
- `noter_echec_plafonne` — L198
- `numeroter_recu` — L786 **(active)** · remplace L417
- `prochain_matricule` — L2954
- `proteger_article_inscription` — L2114 **(active)** · remplace L958
- `proteger_colonnes_ecole` — L377
- `proteger_inscription` — L465
- `proteger_paiement` — L4297 **(active)** · remplace L436, L826, L925
- `reinitialiser_mot_de_passe_utilisateur` — L4748
- `session_ecole_valide` — L318
- `session_utilisateur_valide` — L3944
- `set_updated_at` — L2264
- `situation_abonnement` — L3686
- `verifier_ecriture_ecole` — L3723
- `verifier_meme_ecole` — L2176 **(active)** · remplace L394, L756, L876

## Policies

- `ecole_annule` sur `paiements` — L549
- `ecole_encaisse` sur `paiements` — L546
- `ecole_gere_ses_articles_classe` sur `articles_classe` — L861
- `ecole_gere_ses_articles_inscription` sur `articles_inscription` — L866
- `ecole_gere_ses_classes` sur `classes` — L504
- `ecole_gere_ses_eleves` sur `eleves` — L522
- `ecole_gere_ses_inscriptions` sur `inscriptions` — L532
- `ecole_gere_ses_parents` sur `parents` — L513
- `ecole_lit_sa_fiche` sur `ecoles` — L495
- `ecole_lit_ses_paiements` sur `paiements` — L543
- `ecole_modifie_sa_fiche` sur `ecoles` — L498
- `parent_lit_les_classes` sur `classes` — L508
- `parent_lit_les_inscriptions` sur `inscriptions` — L536
- `parent_lit_sa_fiche` sur `parents` — L517
- `parent_lit_ses_articles` sur `articles_inscription` — L870
- `parent_lit_ses_enfants` sur `eleves` — L526
- `parent_lit_ses_paiements` sur `paiements` — L553

## Triggers

- `trg_abonnement_ecriture` sur `ecoles` — L3768
- `trg_abonnement_ecriture` sur `parents` — L3772
- `trg_abonnement_ecriture` sur `utilisateurs_ecole` — L3851
- `trg_abonnement_modification` sur `parents` — L3776
- `trg_interdire_suppression_paiement` sur `paiements` — L3649
- `trg_meme_ecole` sur `articles_classe` — L915
- `trg_meme_ecole` sur `articles_inscription` — L918
- `trg_meme_ecole` sur `eleves` — L574
- `trg_meme_ecole` sur `inscriptions` — L577
- `trg_meme_ecole` sur `paiements` — L921 **(active)** · remplace L580
- `trg_numeroter_recu` sur `paiements` — L589
- `trg_proteger_article_inscription` sur `articles_inscription` — L2155 **(active)** · remplace L977
- `trg_proteger_colonnes_ecole` sur `ecoles` — L570
- `trg_proteger_inscription_maj` sur `inscriptions` — L597
- `trg_proteger_inscription` sur `inscriptions` — L594
- `trg_proteger_paiement` sur `paiements` — L585

## Index nommés

- `idx_ecoles_email` — L54
- `idx_classes_ecole` — L78
- `idx_parents_ecole` — L91
- `idx_eleves_ecole` — L107
- `idx_eleves_parent` — L108
- `idx_inscriptions_ecole_annee` — L126
- `idx_paiements_inscription` — L150
- `idx_paiements_ecole_date` — L151
- `idx_tentatives_connexion_premier_echec` — L169
- `idx_paiements_lot` — L643
- `idx_paiements_numero_recu` — L645
- `idx_articles_classe_classe` — L689
- `idx_articles_inscription_inscription` — L709
- `idx_paiements_article` — L717
- `idx_articles_inscription_article_classe` — L2248
- `idx_eleves_matricule_ancien` — L2561
- `idx_utilisateurs_ecole_email` — L3825
- `idx_utilisateurs_ecole_directeur` — L3826
- `idx_utilisateurs_ecole_ecole` — L3828

## Contraintes CHECK


## Blocs de migration (v1.x)

- L609 : v1.2 : paiement du dernier mois de scolarité par tranches.
- L625 : v1.3 : nombre de tranches du dernier mois choisi par l'école. NULL = une tranche par mois, du mois de
- L638 : v1.4 : un reçu peut regrouper plusieurs lignes encaissées ensemble (ex : mensualité de janvier + tranche
- L647 : v1.5 : frais de classe paramétrables.
- L750 : v1.1 : correctif du trigger verifier_meme_ecole (erreur 42703 à chaque inscription).
- L780 : v1.4 : reçus regroupés (lot_id). Remplace numeroter_recu et proteger_paiement (section 10).
- L857 : v1.5 : politiques, cohérence multi-écoles et protections des articles.
- L982 : v1.7 : inscription d'un élève en une seule transaction (fonction inscrire_eleve).
- L1260 : v1.8 : encaissement atomique (fonction encaisser_paiement).
- L1509 : v1.9 : enregistrement d'une classe et de son catalogue en une seule transaction (fonction enregistrer_classe).
- L1675 : v1.10 : prix d'article plafonné, produit prix × quantité en bigint (finding H4), classe verrouillée à l'inscription.
- L1961 : v1.11 : paramètres de l'école et passage à l'année suivante en une seule transaction (fonction
- L2103 : v1.13 : un service mensuel ne s'arrête pas avant son dernier mois payé (remplace proteger_article_inscription, v1.5).
- L2159 : v1.14 : un article d'élève vient du catalogue de SA classe (remplace verifier_meme_ecole, v1.5).
- L2252 : v1.15 : date de dernière modification (updated_at) sur eleves, classes, inscriptions, parents et
- L2293 : v1.16 : un service mensuel ne s'encaisse que dans sa période (finding H4 du BACKLOG).
- L2548 : v1.17 : matricule de l'ancien système (reprise de l'existant, tranche 5).
- L2565 : v1.18 : import des élèves d'une école existante par lots (fonction importer_reprise, tranche 5).
- L2935 : v1.19 : durcissements de l'inscription et de l'import, matricule factorisé, paiement protégé de la suppression.
- L3653 : v1.20 : abonnement appliqué automatiquement (feature D02, tranche 1).
- L3780 : v1.21 : plusieurs utilisateurs par école, tranche 1 (feature D09) : connexion par e-mail + mot de passe.
- L4001 : v1.22 : chaque reçu dit qui l'a encaissé (D09, tranche 2).
- L4627 : v1.23 : plusieurs utilisateurs par école, tranche 3 (feature D09) : le directeur gère ses caissiers.

## Notes pour l'agent

- Les blocs v1.x sont en fin de fichier et **remplacent** les
  définitions antérieures. La ligne active est la **dernière**.
- Pour les **triggers** et **policies**, le regroupement est par
  `(nom, table)`. Un même nom de trigger posé sur 5 tables donne
  5 lignes distinctes, toutes actives.
- Quand tu lis une fonction, un trigger ou une policy, **lis la
  version active** (la ligne avec `(active)` ou la seule ligne).
