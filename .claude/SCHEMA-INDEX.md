# Index de schema.sql

> **Fichier généré automatiquement.** Ne pas éditer à la main.
> Régénérer : `bash scripts/schema-index.sh`

**Total : 1506 lignes.**

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

## Vues


## Fonctions

- `changer_code_ecole` — L344
- `code_correspond` — L244
- `controler_tentatives` — L186
- `echanger_acces_ecole` — L270
- `echanger_jeton_parent` — L332
- `effacer_tentatives` — L227
- `encaisser_paiement` — L1276
- `hacher_code_bcrypt` — L257
- `inscrire_eleve` — L994
- `ip_pour_cle` — L237
- `jwt_ecole_id` — L179
- `jwt_parent_id` — L182
- `jwt_role_app` — L176
- `noter_echec_plafonne` — L198
- `numeroter_recu` — L786 **(active)** · remplace L417
- `proteger_article_inscription` — L958
- `proteger_colonnes_ecole` — L377
- `proteger_inscription` — L465
- `proteger_paiement` — L925 **(active)** · remplace L436, L826
- `session_ecole_valide` — L318
- `verifier_meme_ecole` — L876 **(active)** · remplace L394, L756

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

- `trg_meme_ecole` sur `articles_classe` — L915
- `trg_meme_ecole` sur `articles_inscription` — L918
- `trg_meme_ecole` sur `eleves` — L574
- `trg_meme_ecole` sur `inscriptions` — L577
- `trg_meme_ecole` sur `paiements` — L921 **(active)** · remplace L580
- `trg_numeroter_recu` sur `paiements` — L589
- `trg_proteger_article_inscription` sur `articles_inscription` — L977
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

## Notes pour l'agent

- Les blocs v1.x sont en fin de fichier et **remplacent** les
  définitions antérieures. La ligne active est la **dernière**.
- Pour les **triggers** et **policies**, le regroupement est par
  `(nom, table)`. Un même nom de trigger posé sur 5 tables donne
  5 lignes distinctes, toutes actives.
- Quand tu lis une fonction, un trigger ou une policy, **lis la
  version active** (la ligne avec `(active)` ou la seule ligne).
