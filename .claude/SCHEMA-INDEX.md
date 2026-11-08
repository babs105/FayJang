# Index de schema.sql

> **Fichier généré automatiquement.** Ne pas éditer à la main.
> Régénérer : `bash scripts/schema-index.sh`

**Total : 948 lignes.**

## Tables

- `acces_ecole` — L46
- `articles_classe` — L233
- `articles_inscription` — L247
- `classes` — L54
- `compteurs_recus` — L143
- `ecoles` — L21
- `eleves` — L83
- `inscriptions` — L100
- `paiements` — L118
- `parents` — L70
- `schema_migrations` — L14
- `tentatives_connexion` — L152

## Vues


## Fonctions

- `changer_code_ecole` — L484
- `code_correspond` — L380
- `controler_tentatives` — L323
- `echanger_acces_ecole` — L410
- `echanger_jeton_parent` — L472
- `effacer_tentatives` — L359
- `hacher_code_bcrypt` — L393
- `ip_pour_cle` — L373
- `jwt_ecole_id` — L316
- `jwt_parent_id` — L319
- `jwt_role_app` — L313
- `noter_echec_plafonne` — L333
- `numeroter_recu` — L756 **(active)** · remplace L638
- `proteger_article_inscription` — L928
- `proteger_colonnes_ecole` — L585
- `proteger_inscription` — L693
- `proteger_paiement` — L895 **(active)** · remplace L661, L796
- `session_ecole_valide` — L458
- `verifier_meme_ecole` — L846 **(active)** · remplace L606, L726

## Policies

- `ecole_annule` — L573
- `ecole_encaisse` — L570
- `ecole_gere_ses_articles_classe` — L831
- `ecole_gere_ses_articles_inscription` — L836
- `ecole_gere_ses_classes` — L528
- `ecole_gere_ses_eleves` — L546
- `ecole_gere_ses_inscriptions` — L556
- `ecole_gere_ses_parents` — L537
- `ecole_lit_sa_fiche` — L519
- `ecole_lit_ses_paiements` — L567
- `ecole_modifie_sa_fiche` — L522
- `parent_lit_les_classes` — L532
- `parent_lit_les_inscriptions` — L560
- `parent_lit_sa_fiche` — L541
- `parent_lit_ses_articles` — L840
- `parent_lit_ses_enfants` — L550
- `parent_lit_ses_paiements` — L577

## Triggers

- `trg_hacher_code_bcrypt` — L404
- `trg_meme_ecole` — L891 **(active)** · remplace L627, L630, L633, L885, L888
- `trg_numeroter_recu` — L656
- `trg_proteger_article_inscription` — L947
- `trg_proteger_colonnes_ecole` — L602
- `trg_proteger_inscription` — L706
- `trg_proteger_inscription_maj` — L709
- `trg_proteger_paiement` — L689

## Index nommés

- `idx_ecoles_email` — L43
- `idx_classes_ecole` — L67
- `idx_parents_ecole` — L80
- `idx_eleves_ecole` — L96
- `idx_eleves_parent` — L97
- `idx_inscriptions_ecole_annee` — L115
- `idx_paiements_inscription` — L139
- `idx_paiements_ecole_date` — L140
- `idx_tentatives_connexion_premier_echec` — L158
- `idx_paiements_lot` — L199
- `idx_paiements_numero_recu` — L201
- `idx_articles_classe_classe` — L245
- `idx_articles_inscription_inscription` — L264
- `idx_paiements_article` — L268

## Contraintes CHECK


## Blocs de migration (v1.x)

- L165 : v1.2 : paiement du dernier mois de scolarité par tranches.
- L181 : v1.3 : nombre de tranches du dernier mois choisi par l'école. NULL = une tranche par mois, du mois de
- L194 : v1.4 : un reçu peut regrouper plusieurs lignes encaissées ensemble (ex : mensualité de janvier + tranche
- L203 : v1.5 : frais de classe paramétrables.
- L720 : v1.1 : correctif du trigger verifier_meme_ecole (erreur 42703 à chaque inscription).
- L750 : v1.4 : reçus regroupés (lot_id). Remplace numeroter_recu et proteger_paiement (section 10).
- L827 : v1.5 : politiques, cohérence multi-écoles et protections des articles.

## Notes pour l'agent

- Les blocs v1.x sont en fin de fichier et **remplacent** les
  définitions antérieures. La ligne active est la **dernière**
  occurrence.
- Les patterns `DROP ... IF EXISTS ; CREATE ...` sont idempotents :
  l'objet est **actif** après le CREATE.
- **Attention** : une policy droppée **sans** `CREATE` après n'est
  plus active (aucun cas dans le schéma de FayJàng à ce jour).
- Fonctions remplacées dans les blocs finaux : `verifier_meme_ecole` (v1.1),
  `numeroter_recu` et `proteger_paiement` (v1.4). Auditer la version active.
- `trg_meme_ecole` n'a pas de version morte : c'est le même nom de trigger posé sur
  trois tables (eleves, inscriptions, paiements). Les trois lignes sont actives.
- Les contraintes CHECK ajoutées dans un bloc `DO $$` sur plusieurs lignes
  n'apparaissent pas ci-dessus : chercher `ADD CONSTRAINT` dans le schéma.
- Quand tu lis une fonction ou une policy, **lis la version active**
  (la ligne avec `(active)` ou la seule ligne).
