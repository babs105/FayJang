# Backlog — FayJàng

> Les findings d'audit qui ne sont pas corrigés dans la PR courante arrivent ici.
> Un finding dans ce fichier **n'est pas une urgence**. Il attend qu'une feature
> le croise.
>
> Règles :
> - Ne rien corriger depuis ce fichier sans passer par `architect`.
> - Ne rien supprimer sans avoir la preuve que c'est fait (commit, PR, numéro de ligne).
> - Une décision tranchée ne se rouvre pas sans raison nouvelle.
> - Le dev (`dev-encaissement` ou la session principale) gère ce fichier avec l'autorisation de l'humain :
>   il **ajoute** sans demander les findings non corrigés de sa tranche ; il **coche, supprime, modifie**
>   une entrée ou écrit dans « Décisions tranchées » seulement après l'accord explicite de l'humain.
> - Classement (détail dans `.claude/WORKFLOW.md`, section « Le backlog ») :
>   - **Chantier** dès qu'un de ces points est vrai : plus d'1 h de travail, touche `schema.sql`,
>     l'auth ou l'argent (encaissement, reçus, soldes), plus de 2 fichiers, ou décision métier à prendre ;
>   - **Correction mineure** sinon : correctif court et localisé.
>   - Une nouvelle entrée s'ajoute à la fin de sa section, avec son origine (review, tranche, date).

---

## Chantiers (feature-scale, à planifier avec architect)

- [ ] **Inscription d'élève atomique** — `inscrireEleve` crée le parent, l'élève,
  l'inscription puis le paiement des frais en plusieurs requêtes ; en cas d'échec,
  le code supprime ce qu'il a créé, mais un parent créé reste en place et une coupure
  réseau au mauvais moment peut laisser un élève sans inscription. Correctif : fonction
  SQL `inscrire_eleve(...)` (SECURITY DEFINER, contrôle `role_app = 'ecole'`) qui fait
  tout dans une transaction. *Estimé : 1 jour. Croise : import Excel des élèves.*

- [ ] **Double-clic sur Encaisser (idempotence UI)** — le bouton est désactivé
  pendant l'envoi, mais un double-clic rapide ou un réseau lent peut créer deux
  reçus. Correctif : clé d'idempotence générée à l'ouverture du formulaire et
  contrainte UNIQUE `(ecole_id, lot_id)` sur la première ligne du lot.
  *Estimé : 4 h. Croise : toute évolution de l'encaissement.*

- [ ] **Encaissement atomique (paiements simultanés)** — `encaisserPaiement` et
  `inscrireEleve` recalculent le reste dû puis insèrent sans verrou : deux
  encaissements simultanés sur la même inscription (deux onglets, deux
  comptables) peuvent surpayer. Correctif : fonction SQL `encaisser(...)`
  SECURITY DEFINER (`search_path` fixé, REVOKE, contrôle `role_app = 'ecole'`)
  qui verrouille l'inscription (`FOR UPDATE`), recalcule et insère le lot.
  **À traiter avec « Inscription d'élève atomique »** : même pattern de
  fonction SQL transactionnelle. *Estimé : 0,5 jour. Croise : prochaine
  évolution de l'encaissement.*

- [ ] **Opérations multi-étapes non atomiques** — `enregistrerClasse` (classe puis
  catalogue ligne par ligne), `inscrireEleve` (parent, élève, inscription, articles,
  paiement) et la copie d'année de `enregistrerParametres` : en cas d'échec au milieu,
  l'état reste partiel ; les rollbacks côté code ne couvrent pas tout. Correctif : une
  RPC SQL transactionnelle par opération. *Estimé : 1 jour. Croise : « Inscription
  d'élève atomique », import Excel.*


- [ ] **`updated_at` absent hors `acces_ecole`** (M1) — aucune trace de la dernière
  modification d'un élève, d'une classe ou d'une inscription. *Estimé : 2 h. Croise :
  journal des modifications.*

- [ ] **Invariants des articles tenus seulement par le code** — la base ne vérifie pas
  que `articles_inscription.article_classe_id` appartient à la classe de l'inscription,
  ni que `mois_fin` reste ≥ au dernier mois payé (trigger `proteger_article_inscription`,
  `supabase/schema.sql`). Correctif : contrôles dans `verifier_meme_ecole` et
  `proteger_article_inscription`. *Estimé : 2 h. Croise : tout import de données.*

- [ ] **Paiement libre sur élève parti contrôlé seulement par le code** — la base accepte un paiement
  `autre` sur une inscription en abandon ou transfert (policy `ecole_encaisse` sans contrôle de
  statut). Correctif : contrôle dans `verifier_meme_ecole` ou trigger dédié. *Estimé : 30 min.
  Croise : clôture d'année / réinscription.* (review tranche 2, 2026-11-08)

---

## Corrections mineures (à appliquer quand une feature croise le sujet)

- [ ] **Suppression accidentelle d'un paiement en éditeur SQL** — aucune policy
  `FOR DELETE`, aucun trigger `BEFORE DELETE` sur `paiements`. La RLS protège
  l'application (JWT), mais l'éditeur SQL (rôle postgres) bypass la RLS. Un
  humain peut supprimer un vrai reçu par accident. Correctif : trigger
  `BEFORE DELETE` + flag `SET LOCAL fayjang.allow_paiement_delete = 'on'` pour
  le nettoyage de tests. *Estimé : 1 h. Croise : mise en production avec de
  vrais reçus.*

- [ ] **Headers de sécurité absents** (S9) — aucun `X-Frame-Options`,
  `X-Content-Type-Options`, `Referrer-Policy`, CSP dans `next.config.ts`. Le
  `Referrer-Policy` compte : l'URL de la page parent contient le token. Correctif :
  `headers()` dans `next.config.ts`. *Estimé : 1 h. Croise : prochaine tranche sur /p/[token].*

- [ ] **Node.js 20 en local** — `@supabase/supabase-js` annonce la fin du support de
  Node 20. Vercel est déjà en 26.x. *Estimé : 15 min. Croise : prochaine mise à jour des dépendances.*

- [ ] **Rotation des secrets de développement** — la clé de signature JWT et
  `ECOLE_SESSION_SECRET` du `.env.local` ont été affichés en clair dans un terminal
  le 2026-11-07. Ne pas les réutiliser en production. *Estimé : 15 min. Croise :
  configuration de la production Vercel.*

- [ ] **Dates saisies : 31 février accepté** — `isDateValide` (`src/lib/dates.ts`) accepte une date
  inexistante (ex. 2026-02-31) ; corrigé pour la date de départ (contrôle par aller-retour dans
  `modifierInscription`), mais pas pour la date de naissance (`inscrireEleve`, `modifierEleve`).
  Correctif : renforcer `isDateValide` par l'aller-retour ISO. *Estimé : 15 min. Croise : prochaine
  tranche sur la fiche élève.* (review tranche 2 « départ d'un élève », 2026-11-08)

- [ ] **Erreur 23514 de `modifierInscription` reconnue par sous-chaîne** — la contrainte de la date
  de départ est repérée par « date_depart » dans le message ; toute autre contrainte CHECK future
  afficherait le message de la réduction. Correctif : tester les noms complets des contraintes.
  *Estimé : 10 min. Croise : prochaine modification de `modifierInscription`.* (review tranche 2, 2026-11-08)

- [ ] **Plafond de lignes sur le calcul du matricule** — corrigé par tri décroissant + `limit(1)` ;
  au-delà de 9 999 élèves sur une année (matricule à 7 caractères), l'ordre texte ne suivrait plus
  l'ordre numérique. *Estimé : 15 min. Croise : très grosses écoles.* (review du hotfix matricule, 2026-11-08)

- [ ] **Formules Excel non neutralisées dans l'export** — les noms d'élève et de parent saisis
  librement peuvent commencer par `=`, `+`, `-` ou `@` et être interprétés comme formules à
  l'ouverture (`src/app/ecole/export/route.ts`). Correctif : préfixer d'une apostrophe ces chaînes
  avant `addRow`. *Estimé : 20 min. Croise : toute évolution de l'export.* (review tranche 3 « départ d'un élève », 2026-11-08)

- [ ] **Identifiants et date de naissance non contrôlés à l'inscription** (S7) — `inscrireEleve` ne vérifie
  pas que `eleve_id` et `classe_id` sont des UUID, ni qu'une date de naissance n'est pas dans le futur :
  le message reste générique (« Opération impossible… ») ou la date future est acceptée. Le 31 février
  relève de l'entrée « Dates saisies » ci-dessus. Correctif : regex UUID avec « Classe ou élève invalide. »
  et `date_naissance <= todayDakar()`. *Estimé : 20 min. Croise : tranche 2 « inscription atomique ».*
  (review security tranche 1 « inscription atomique », 2026-11-10)

- [ ] **Message ambigu pour une classe désactivée** — `inscrire_eleve` (bloc v1.7 de
  `supabase/schema/05-migrations.sql`) répond « Choisissez une classe. » pour une classe désactivée comme
  pour une classe inexistante. Correctif : « Classe introuvable ou désactivée. », sans distinguer une classe
  d'une autre école. *Estimé : 5 min. Croise : tranche 2 « inscription atomique ».*
  (review database tranche 1 « inscription atomique », 2026-11-10)

- [ ] **Parent connu réécrit à chaque inscription** — `ON CONFLICT … DO UPDATE SET nom = p.nom` dans
  `inscrire_eleve` crée une nouvelle version de la ligne `parents` (un peu de bloat, verrou de ligne).
  Correct fonctionnellement. Correctif si besoin : `ON CONFLICT DO NOTHING RETURNING id` puis `SELECT`.
  *Estimé : 15 min. Croise : import Excel des élèves (inscriptions en masse).*
  (review database tranche 1 « inscription atomique », 2026-11-10)

- [ ] **Signature de `inscrire_eleve` à garder en tranche 2** (M3) — le `CREATE OR REPLACE` de la tranche 2
  doit garder exactement les 14 types de paramètres, sinon une surcharge (erreur PostgREST PGRST203) et des
  REVOKE/GRANT à refaire. Retirer aussi le refus de l'encaissement et valider le contenu de
  `p_lignes_paiement`. *Estimé : inclus dans la tranche 2. Croise : tranche 2 « inscription atomique ».*
  (review database tranche 1 « inscription atomique », 2026-11-10)

---

## Décisions tranchées (ne plus rouvrir)

- [x] **Un paiement ne se supprime ni ne se modifie** : annulation motivée seulement,
  reçu barré « ANNULÉ », annulation par reçu entier (lot). (2026-11-07)
- [x] **Le dernier mois peut se payer par tranches** : mois de début et nombre de
  tranches réglés par l'école, tranche incluse dans le reçu de la mensualité, case
  cochée par défaut. (2026-11-08)
- [x] **Commits signés avec l'adresse noreply GitHub** dans ce dépôt (l'adresse Gmail
  n'est pas reliée au compte, Vercel refusait le déploiement). (2026-11-08)
- [x] **Nom de l'application : FayJàng** (identifiants techniques sans accent :
  `fayjang`). (2026-11-08)
- [x] **Réglages d'encaissement fixés par l'école en début d'année** (1er / dernier mois à
  l'inscription, mois payé par tranches) : ils restent au niveau de l'école, pas figés sur
  chaque inscription. (2026-11-08)
- [x] **Départ d'un élève (abandon, transfert)** : une date de départ est enregistrée ; les mois
  jusqu'au mois du départ inclus (mois entamé = dû) restent dus, ceux d'après ne le sont plus
  (ce qui est déjà payé est gardé, pas de remboursement). Restent dus : frais d'inscription,
  frais uniques (tenues…), 1er mois payé à l'inscription. Anciens abandons sans date : ancien
  calcul + bandeau « date de départ manquante ». Le parent voit « Départ enregistré le … ». (2026-11-08)
- [x] **Paiement libre refusé pour un élève parti** (abandon ou transfert). Appliqué dans
  `encaisserPaiement` et l'interface (commit `3e3c4bb`). (2026-11-08)
- [x] **Exception au gel du schéma** pour la seule colonne `inscriptions.date_depart` (ajout pur,
  feature « départ d'un élève »). (2026-11-08)
- [x] **Préfixe des reçus encore « JP- »** — vient de l'ancien nom JàngPay. Passer à
  « FJ- » demande un bloc final qui remplace `numeroter_recu` .(2026-11-09)
