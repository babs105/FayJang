# Mise en production de FayJàng

Projet Vercel : `fayjang` (https://fayjang.vercel.app), dépôt `babs105/FayJang`, branche `main`.

## 0. Livraison en cours : F20 « Reprise de l'existant » (blocs v1.16 à v1.19)

`main` contient le schéma jusqu'au bloc v1.15. La branche `feat/import-reprise` ajoute :

| Bloc | Ce qu'il apporte |
|---|---|
| v1.16 | `encaisser_paiement` refuse un service mensuel hors de sa période (FJ412) |
| v1.17 | Colonne `eleves.matricule_ancien`, sa contrainte et son index unique par école |
| v1.18 | Fonction `importer_reprise` (import par lots de 25) |
| v1.19 | `prochain_matricule`, `inscrire_eleve` et `importer_reprise` redéfinies (mêmes signatures), trigger `trg_interdire_suppression_paiement` |

**Ordre impératif : schéma d'abord, code ensuite.** Le nouveau code lit `eleves.matricule_ancien` et appelle
`importer_reprise` : sans le schéma, l'onglet Importer échoue. Les quatre blocs ne font qu'ajouter ou redéfinir à
signature égale (d'après leurs en-têtes) : le code actuellement en production continue de fonctionner entre les deux étapes.

1. Sauvegarde (section 1), puis relancer `supabase/schema.sql` **de `feat/import-reprise`** sur la base de production.
2. Contrôles de la section 2, dont ceux de F20.
3. `NEXT_DIST_DIR=.next-build npm run build` et `npm test` sur la branche, puis accord explicite pour le merge.
4. Merger `feat/import-reprise` → `main` et pousser (un seul déploiement).
5. Vérifications de la section 4, dont « Reprise de l'existant ».
6. Passer F20 à « Livrée » dans `docs/feature-spec.md` avec le commit de merge, et lever les mentions « Sur la branche ».

**À savoir après v1.19** : un paiement ne se supprime plus, même depuis l'éditeur SQL. Pour nettoyer des données de
test, dans une même transaction : `BEGIN; SET LOCAL fayjang.allow_paiement_delete = 'on'; DELETE ... ; COMMIT;`

<details>
<summary>Livraisons précédentes (v1.5 et v1.6), pour mémoire</summary>

Schéma v1.5 (articles et services par classe, mensualité du dernier mois, mois payés à l'inscription, mois payé par
tranches au choix) et v1.6 (date de départ d'un élève, `inscriptions.date_depart`), livrés par `feat/frais-classe`
puis `feat/depart-eleve`, schéma d'abord. Leurs contrôles restent dans les sections 2 et 4.

</details>

---

## 1. Projet Supabase de production

- [ ] Vérifier que l'intégration Supabase de Vercel pointe vers **le bon projet** (celui où le schéma sera lancé) :
  Vercel → fayjang → Settings → Environment Variables, `NEXT_PUBLIC_SUPABASE_URL`.
- [ ] **Sauvegarde** : sur l'offre Free, aucune sauvegarde automatique n'est conservée. Avant toute relance sur une
  base qui contient de vrais paiements, exporter `paiements`, `inscriptions`, `eleves`, `parents` (et supprimer
  l'export une fois la relance vérifiée : il contient des données de familles).
- [ ] **Droits de pgcrypto** (deux `true` attendus, sinon l'inscription d'une école échoue) :
  ```sql
  SELECT has_function_privilege('service_role', 'extensions.crypt(text,text)', 'EXECUTE'),
         has_function_privilege('service_role', 'extensions.gen_salt(text,integer)', 'EXECUTE');
  ```

## 2. Relance du schéma

- [ ] Coller `supabase/schema.sql` en entier, en une seule exécution : celui de la **branche à livrer** quand le
  schéma passe avant le code (cas de F20, section 0), celui de `main` sinon.
- [ ] Contrôles après relance :
  ```sql
  SELECT column_name FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name IN ('ecoles', 'paiements', 'classes', 'inscriptions')
    AND column_name IN ('lot_id', 'nb_tranches', 'tranches_dernier_mois', 'mois_debut_tranches', 'article_id',
                        'mensualite_dernier_mois', 'rang_mois_tranches', 'premier_mois_a_linscription',
                        'dernier_mois_a_linscription', 'date_depart');                               -- 11 lignes
  SELECT count(*) FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name IN ('articles_classe', 'articles_inscription');       -- 2
  SELECT count(*) FROM pg_policies WHERE schemaname = 'public';                                     -- 17
  SELECT table_name, privilege_type FROM information_schema.role_table_grants
  WHERE table_schema = 'public' AND grantee = 'anon';                                                -- 0 ligne
  ```
- [x] **Version unique de `encaisser_paiement` à vérifier en base** — après application du schéma :
  `SELECT oid::regprocedure FROM pg_proc WHERE proname = 'encaisser_paiement';` doit renvoyer une ligne (PGRST203
  sinon). *Estimé : 2 min. Croise : mise en production de « encaissement atomique ».*
  (plan architect « encaissement atomique », 2026-11-10)
- [X] **Version unique de `inscrire_eleve` à vérifier en base** — après application du schéma, s'assurer qu'une
  seule signature existe : `SELECT oid::regprocedure FROM pg_proc WHERE proname = 'inscrire_eleve';` doit renvoyer
  une ligne (une surcharge donnerait l'erreur PostgREST PGRST203). *Estimé : 2 min. Croise : mise en production
  de « inscription atomique ».* (review database tranche 2 « inscription atomique », 2026-11-10)
- [ ] Une seule version de chaque fonction v1.9 à v1.11 (une surcharge donnerait l'erreur PostgREST PGRST203).
  Vérifié en base locale, pas encore sur Supabase :
  ```sql
  SELECT oid::regprocedure FROM pg_proc
  WHERE proname IN ('enregistrer_classe', 'enregistrer_parametres', 'inscrire_eleve');               -- 3 lignes
  ```
- [ ] **Contrôles de F20 (blocs v1.16 à v1.19)** :
  ```sql
  SELECT column_name FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'eleves' AND column_name = 'matricule_ancien';     -- 1 ligne
  SELECT indexname FROM pg_indexes
  WHERE schemaname = 'public' AND indexname = 'idx_eleves_matricule_ancien';                         -- 1 ligne
  SELECT oid::regprocedure FROM pg_proc
  WHERE proname IN ('encaisser_paiement', 'importer_reprise', 'prochain_matricule', 'inscrire_eleve'); -- 4 lignes
  SELECT tgname FROM pg_trigger
  WHERE tgname = 'trg_interdire_suppression_paiement' AND NOT tgisinternal;                          -- 1 ligne
  ```

## 3. Variables Vercel (Production, et Preview si utilisé)

Générer des **valeurs neuves** : ne pas reprendre celles du `.env.local` de développement.

- [ ] `SUPABASE_JWT_PRIVATE_KEY` : nouvelle clé (`npx supabase gen signing-key --algorithm ES256`), **importée aussi**
  dans Supabase → Project Settings → JWT Keys et activée. Sans elle, plus aucune requête École ni parent.
- [ ] `ECOLE_SESSION_SECRET` : 32 caractères minimum (`openssl rand -hex 32`).
- [ ] `NEXT_PUBLIC_APP_URL` = `https://fayjang.vercel.app` (déjà en place depuis le 2026-11-08).
- [ ] `SUPERADMIN_CODE` : 12 caractères minimum, gardé hors du dépôt.
- [ ] `DIAGNOSTIC_SECRET` : 16 caractères minimum. Sans lui, `/api/diagnostic` répond 404.
- [ ] `WAVE_NUMERO_PAIEMENT` (facultatif).
- [ ] Redéployer après l'ajout des variables (les `NEXT_PUBLIC_*` sont figées au build).

## 4. Vérifications en production

Avec l'école de test, pas les données d'une vraie école.

**Diagnostic**
- [ ] Sans en-tête : 404. Avec `x-diagnostic-secret` : toutes les variables « ok », `connexionSupabase: ok`, `jwtRls: ok`.
  ```bash
  curl -H "x-diagnostic-secret: $DIAGNOSTIC_SECRET" https://fayjang.vercel.app/api/diagnostic
  ```

**Inscription et connexion**
- [ ] `/inscription` : une école de test est créée, arrivée sur l'onglet Classes.
- [ ] `/ecole/login` : bon code accepté (slug et e-mail), mauvais code refusé ; 5 mauvais codes → message de blocage.
- [ ] Changement de code dans Paramètres → déconnexion, reconnexion avec le nouveau code.

**Scolarité**
- [ ] Créer une classe, inscrire deux enfants avec le même téléphone de parent (un seul parent créé).
- [ ] Encaisser octobre en Wave (référence exigée) → reçu PDF correct.
- [ ] Exemple de référence : 6e à 50 000 d'inscription et 20 000 par mois, tenue 7 500 × 2, blouson 12 000, jacket 15 000,
  transport 10 000/mois en option ; octobre → juin, 1er et dernier mois à l'inscription, mai en 3 tranches à partir de février.
  Inscription « encaisser maintenant » → **132 000** sur un seul reçu de 6 lignes ; reste sur l'année 140 000.
- [ ] Février payé → reçu de **26 666** (mensualité + « Tranche 1/3 de mai 2027 »), un seul numéro.
- [ ] Ajouter puis arrêter le transport d'un élève ; les mois payés restent visibles.
- [ ] Annuler un reçu → toutes ses lignes annulées, PDF barré « ANNULÉ », soldes revenus.
- [ ] Export Excel : onglets Paiements et Soldes.

**Parent**
- [ ] Le lien « Envoyer le lien parent » pointe vers `https://fayjang.vercel.app/p/...` (pas `localhost`).
- [ ] La page parent affiche les deux enfants, les tranches et les reçus ; un reçu annulé n'apparaît pas.
- [ ] « Nouveau lien » → l'ancien lien renvoie une page introuvable.

**Console**
- [ ] `/admin/login` avec `SUPERADMIN_CODE` ; désactiver l'école de test → connexion et lien parent refusés ; réactiver.

**Reprise de l'existant (F20), avec l'école de test**
- [ ] Onglet Importer : envoyer le fichier modèle rempli → aperçu chiffré élève par élève, sans rien écrire.
- [ ] Créer les classes manquantes, puis importer : un reçu « Reprise de l'existant » par élève qui a versé,
  aucun reçu pour un élève sans versement.
- [ ] Rejouer le même fichier → 0 création (doublons écartés).
- [ ] Tableau de bord : la reprise ne compte ni dans le jour ni dans le mois, seulement dans l'année (« dont … repris »).
- [ ] Encaisser un service mensuel hors de sa période → refus « … est hors de la période du service ».
- [ ] Supprimer un paiement depuis l'éditeur SQL → refusé par la base.

**Départ d'un élève (v1.6), avec un élève de test**
- [ ] Fiche élève → statut « Abandon », date du jour → bandeau « Parti le … », mois suivants grisés, arriéré = mois dus
  jusqu'au départ (ex. inscription 25 000 non payée + octobre et novembre = 65 000).
- [ ] La case « Paiement libre » disparaît pour cet élève ; elle revient au retour en « Inscrit ».
- [ ] Liste des élèves (« Abandon le … »), Impayés (badge), relance WhatsApp (« dû jusqu'à son départ le … »),
  export Excel (colonnes Statut, Date de départ) et page parent (« Départ enregistré le … ») : même arriéré partout.
- [ ] Retour en « Inscrit » : date effacée, calcul normal.
- [ ] Une nouvelle inscription après la suppression d'un élève reçoit un matricule libre (correctif du 2026-11-08).

## 5. Avant les premiers vrais reçus

- [ ] Décider du préfixe des reçus (« JP- » hérité de l'ancien nom, ou « FJ- ») : voir la section 9
  « Décisions tranchées » de `docs/feature-spec.md`.
- [ ] Prévoir une sauvegarde régulière des paiements (export Excel mensuel par école, ou offre Supabase avec sauvegardes).
- [ ] Désactiver ou supprimer l'école de test.
