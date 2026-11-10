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

- [ ] **Opérations multi-étapes non atomiques** — `enregistrerClasse` (classe puis
  catalogue ligne par ligne) et la copie d'année de `enregistrerParametres` : en cas
  d'échec au milieu, l'état reste partiel ; les rollbacks côté code ne couvrent pas tout.
  Correctif : une RPC SQL transactionnelle par opération, sur le modèle de
  `inscrire_eleve` (bloc v1.7). *Estimé : 1 jour. Croise : import Excel.*


- [ ] **`updated_at` absent hors `acces_ecole`** (M1) — aucune trace de la dernière
  modification d'un élève, d'une classe ou d'une inscription. *Estimé : 2 h. Croise :
  journal des modifications.*

- [ ] **Invariants des articles tenus seulement par le code** — la base ne vérifie pas
  que `articles_inscription.article_classe_id` appartient à la classe de l'inscription,
  ni que `mois_fin` reste ≥ au dernier mois payé (trigger `proteger_article_inscription`,
  `supabase/schema.sql`). Correctif : contrôles dans `verifier_meme_ecole` et
  `proteger_article_inscription`. *Estimé : 2 h. Croise : tout import de données.*

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

- [ ] **Formules Excel non neutralisées dans l'export** — les noms d'élève et de parent saisis
  librement peuvent commencer par `=`, `+`, `-` ou `@` et être interprétés comme formules à
  l'ouverture (`src/app/ecole/export/route.ts`). Correctif : préfixer d'une apostrophe ces chaînes
  avant `addRow`. *Estimé : 20 min. Croise : toute évolution de l'export.* (review tranche 3 « départ d'un élève », 2026-11-08)

- [ ] **`classe_id` et date de naissance non contrôlés à l'inscription** (S7) — `inscrireEleve` ne vérifie
  pas que `classe_id` est un UUID, ni qu'une date de naissance n'est pas dans le futur : le message reste
  générique (« Opération impossible… ») ou la date future est acceptée. `eleve_id` est contrôlé depuis la
  tranche 2. Le 31 février relève de l'entrée « Dates saisies » ci-dessus. Correctif : regex UUID avec
  « Choisissez une classe. » et `date_naissance <= todayDakar()`. *Estimé : 15 min. Croise : prochaine
  tranche sur la fiche élève.*
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

- [ ] **Prix d'article sans plafond et produit calculé en `int`** (H4) — ni `articles_classe.prix_unitaire` ni
  `articles_inscription.prix_unitaire` n'ont de borne haute ; dans `inscrire_eleve`, `ai.prix_unitaire * ai.quantite`
  peut dépasser l'entier 32 bits (erreur 22003, message générique, tout est annulé). Correctif :
  `ai.prix_unitaire::bigint * ai.quantite` et `CHECK (prix_unitaire <= 99999999)` NOT VALID dans
  `05-migrations.sql`. *Estimé : 20 min. Croise : catalogue de frais de classe.*
  (review database tranche 2 « inscription atomique », 2026-11-10)

- [ ] **Message FJ422 unique pour l'encaissement à l'inscription** — une ligne mal formée, un montant au-delà du
  dû ou un libellé trop long donnent tous « Montant à encaisser incohérent avec le tarif, réessayez. » ; le libellé
  du catalogue (`articles_classe.libelle`) n'a pas de plafond en base (coupé à 120 côté serveur). Correctif :
  CHECK de longueur sur le libellé du catalogue et messages distincts. *Estimé : 30 min. Croise : feature
  « paramètres de classe ».* (review database tranche 2 « inscription atomique », 2026-11-10)

- [ ] **Commentaire de tête du bloc v1.7 trop affirmatif** — il dit que chaque ligne correspond à « un élément
  réellement dû », alors que pour une mensualité la base vérifie seulement « mois de l'année, ≤ dû du mois » (un
  mois payé d'avance reste accepté). Correctif : reformuler le commentaire. *Estimé : 5 min. Croise : prochaine
  évolution de `inscrire_eleve`.* (review database tranche 2 « inscription atomique », 2026-11-10)

- [ ] **Tarif modifié entre le calcul et l'enregistrement de l'inscription** — l'action lit les tarifs puis
  appelle `inscrire_eleve` : si le tarif baisse entre les deux, la base refuse (FJ422, « réessayez ») ; s'il monte,
  le reçu est inférieur au dû et le solde apparaît en reste. Sans danger, rien à corriger : à documenter.
  *Estimé : 10 min (doc). Croise : modification des tarifs en cours d'année.*
  (review database tranche 2 « inscription atomique », 2026-11-10)

- [ ] **Version unique de `inscrire_eleve` à vérifier en base** — après application du schéma, s'assurer qu'une
  seule signature existe : `SELECT oid::regprocedure FROM pg_proc WHERE proname = 'inscrire_eleve';` doit renvoyer
  une ligne (une surcharge donnerait l'erreur PostgREST PGRST203). *Estimé : 2 min. Croise : mise en production
  de « inscription atomique ».* (review database tranche 2 « inscription atomique », 2026-11-10)

- [ ] **« Rien à encaisser » reconnu par son texte** (S7) — `inscrireEleve` repère ce cas avec
  `calcul.erreur.startsWith("Rien à encaisser")` ; si le libellé de `lignesAEncaisser` change, une inscription sans
  rien à payer serait refusée à tort (rien créé). Correctif : indicateur explicite renvoyé par
  `lignesPaiementInscription`. *Estimé : 15 min. Croise : prochaine évolution de `lignesAEncaisser`.*
  (review security tranche 2 « inscription atomique », 2026-11-10)

- [ ] **Rejeu d'encaissement : mode et référence non comparés** (S7) — `encaisser_paiement` (bloc v1.8) accepte
  un rejeu de la même clé avec un autre mode de paiement ou une autre référence et renvoie le reçu initial sans le
  signaler. Sans risque (même école, même élève). Correctif : comparer aussi `mode` / `reference`, ou documenter le
  comportement. *Estimé : 15 min. Croise : prochaine évolution de `encaisser_paiement`.*
  (review security tranche 1 « encaissement atomique », 2026-11-10)

- [ ] **`inscription_id` non validé en UUID dans `encaisserPaiement`** (S7) — un identifiant malformé part en
  base et revient en erreur 22P02, interceptée par `messageErreur` (message générique, aucune fuite). Correctif :
  valider le format UUID avant la requête. *Estimé : 10 min. Croise : durcissement des Server Actions.*
  (review security tranche 1 « encaissement atomique », 2026-11-10)

- [ ] **Verrou de lot absent de `inscrire_eleve`** (M4) — `encaisser_paiement` prend `pg_advisory_xact_lock` sur
  `(école, lot_id)`, pas `inscrire_eleve` : un même `lot_id` partagé entre les deux fonctions en parallèle n'est pas
  couvert (deux UUID identiques, improbable). Correctif : prendre le même verrou dans `inscrire_eleve`.
  *Estimé : 10 min. Croise : prochaine migration touchant `inscrire_eleve`.*
  (review database tranche 1 « encaissement atomique », 2026-11-10)

- [ ] **Encaissements d'une école sérialisés par le compteur de reçus** (M5) — `numeroter_recu` met à jour la ligne
  unique `compteurs_recus` (école, année) : tous les encaissements d'une école attendent le commit du précédent.
  Acceptable à l'échelle d'une école ; ne pas allonger les transactions d'encaissement. *Estimé : à mesurer.
  Croise : montée en charge.* (review database tranche 1 « encaissement atomique », 2026-11-10)

- [ ] **Version unique de `encaisser_paiement` à vérifier en base** — après application du schéma :
  `SELECT oid::regprocedure FROM pg_proc WHERE proname = 'encaisser_paiement';` doit renvoyer une ligne (PGRST203
  sinon). *Estimé : 2 min. Croise : mise en production de « encaissement atomique ».*
  (plan architect « encaissement atomique », 2026-11-10)

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
- [x] **Inscription d'élève atomique** — fonction SQL `inscrire_eleve` (bloc v1.7 de
  `supabase/schema/05-migrations.sql`) : parent, élève, inscription, articles et reçu d'inscription
  créés en une seule transaction ; un échec n'en laisse aucun et ne consomme pas de numéro de reçu.
  SECURITY INVOKER (et non DEFINER comme prévu au départ) : la RLS École reste appliquée, `ecole_id`
  vient du JWT. Le dû reste calculé en TypeScript (`situationInscription`), la base vérifie seulement
  les plafonds. Tranche 1 : commit `561ff6d` ; tranche 2 : commit `865f9d2`. (2026-11-10)
- [x] **Plafond de lignes sur le calcul du matricule** — le matricule est calculé par `inscrire_eleve`
  (plus grand suffixe numérique + 1, sous verrou), sans lecture plafonnée ni ordre texte ; testé : après
  269999 vient 2610000. Commit `561ff6d`. (2026-11-10)
- [x] **Signature de `inscrire_eleve` gardée en tranche 2** — mêmes 14 paramètres, refus de l'encaissement
  retiré, lignes de paiement validées avant tout cast. Commit `865f9d2`. (2026-11-10)
- [x] **Parent existant à l'inscription** : même téléphone dans l'école = même parent ; son nom et son lien
  ne changent pas (un parent désactivé est réutilisé sans être réactivé). (2026-11-10)
- [x] **Encaissement atomique (paiements simultanés)** — fonction SQL `encaisser_paiement` (bloc v1.8 de
  `supabase/schema/05-migrations.sql`), SECURITY INVOKER : verrou de l'inscription (`FOR NO KEY UPDATE`),
  empreinte des paiements lus par le serveur (tout changement depuis la lecture → FJ412 « Un autre encaissement
  ou une annulation vient d'être enregistré… »), plafonds d'après les tarifs figés de l'inscription, un seul
  INSERT. Le calcul fin reste dans `situationInscription` ; conflit en FJ412 (pas de FJ409) ; pas d'index unique
  sur `paiements`. Testé en preview : deux postes à la même milliseconde → un seul reçu. Commit `013056d`. (2026-11-10)
- [x] **Double-clic sur Encaisser (idempotence)** — clé d'encaissement (`lot_id`) générée par la fiche élève et
  rejouée par `encaisser_paiement` : même clé et même contenu (comparé ligne par ligne) → le reçu existant est
  renvoyé sans rien ajouter ; même clé et autre contenu, ou reçu annulé → refus FJ412. Côté base : commit
  `013056d` ; côté fiche élève : tranche 2 « encaissement atomique ». (2026-11-10)
- [x] **Paiement libre refusé pour un élève parti, aussi en base** — `encaisser_paiement` refuse un paiement libre
  si l'inscription n'est pas active (FJ412). Couvre le seul chemin d'encaissement ; la policy RLS `ecole_encaisse`
  n'a pas changé. Commit `013056d`. (2026-11-10)
