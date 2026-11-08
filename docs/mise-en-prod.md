# Mise en production de FayJàng (v1.5 + v1.6)

Projet Vercel : `fayjang` (https://fayjang.vercel.app), dépôt `babs105/FayJang`, branche `main`.
Schéma : `supabase/schema.sql` v1.5 (articles et services par classe, mensualité du dernier mois, mois payés à l'inscription,
mois payé par tranches au choix) et v1.6 (date de départ d'un élève, `inscriptions.date_depart`).

**Ordre de déploiement (une feature = un merge vers `main`) :**
1. Relancer `supabase/schema.sql` **de `feat/depart-eleve`** (contient v1.5 et v1.6) sur la base de production.
   Les deux blocs ne font qu'ajouter : le code actuellement en production continue de fonctionner.
2. Merger `feat/frais-classe` → `main` et pousser (déploiement v1.5), puis faire les vérifications v1.5 (section 4).
3. Merger `feat/depart-eleve` → `main` et pousser (déploiement v1.6), puis les vérifications « Départ ».

**Ordre impératif : schéma d'abord, code ensuite.** Le code de la v1.5 lit `articles_classe`, `articles_inscription`,
`paiements.article_id`, `mensualite_dernier_mois`, `rang_mois_tranches`, `premier_mois_a_linscription` et
`dernier_mois_a_linscription` : sans le schéma, l'Espace École affiche « base pas à jour » et l'encaissement échoue.

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

- [ ] Coller `supabase/schema.sql` **de `main`** en entier, en une seule exécution.
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

**Départ d'un élève (v1.6), avec un élève de test**
- [ ] Fiche élève → statut « Abandon », date du jour → bandeau « Parti le … », mois suivants grisés, arriéré = mois dus
  jusqu'au départ (ex. inscription 25 000 non payée + octobre et novembre = 65 000).
- [ ] La case « Paiement libre » disparaît pour cet élève ; elle revient au retour en « Inscrit ».
- [ ] Liste des élèves (« Abandon le … »), Impayés (badge), relance WhatsApp (« dû jusqu'à son départ le … »),
  export Excel (colonnes Statut, Date de départ) et page parent (« Départ enregistré le … ») : même arriéré partout.
- [ ] Retour en « Inscrit » : date effacée, calcul normal.
- [ ] Une nouvelle inscription après la suppression d'un élève reçoit un matricule libre (correctif du 2026-11-08).

## 5. Avant les premiers vrais reçus

- [ ] Décider du préfixe des reçus (« JP- » hérité de l'ancien nom, ou « FJ- ») : voir `BACKLOG.md`.
- [ ] Prévoir une sauvegarde régulière des paiements (export Excel mensuel par école, ou offre Supabase avec sauvegardes).
- [ ] Désactiver ou supprimer l'école de test.
