# Feature spec — FayJàng

> Inventaire des fonctionnalités de FayJàng, livrées et à développer, écrit pour la méthode
> **feature-specific** du projet (`.claude/WORKFLOW.md`) : une feature = un flow utilisateur
> livrable de bout en bout, découpé en tranches verticales par `architect`.
>
> État au **2026-11-12**, branche `main` (merge `ccf271e`). Ce document décrit le **quoi** ; le plan
> d'une feature (tranches, scope des reviews) reste produit par `architect` au moment de la lancer.
> Les bugs dont la correction est reportée ne sont pas ici : ils vivent dans `BACKLOG.md` (backlog de bugs).
> À l'inverse, un **besoin** (nouvelle feature à développer) ou une **piste** repéré pendant une review ou un
> dev arrive ici, en section 6 ou 7, jamais dans le backlog.

## 1. Acteurs et espaces

| Acteur | Espace | Accès |
|---|---|---|
| Administration de l'école | `/ecole` (Espace École, 7 onglets) | Identifiant + code, cookie de session 30 jours |
| Parent ou tuteur | `/p/[token]` | Lien magique, sans mot de passe, page serveur seule |
| SuperAdmin FayJàng | `/admin` | Code SuperAdmin, session 12 h |
| École qui découvre | `/` et `/inscription` | Public |

## 2. Principes qui s'appliquent à toute feature

- **On paie d'abord** : le service vient après le paiement. C'est la règle qui tranche les cas d'argent.
- **Un paiement ne se supprime ni ne se modifie** : on l'annule avec un motif, le reçu reste, barré « ANNULÉ ».
- **Le serveur recalcule** : soldes par `situationInscription()`, jamais de montant cru depuis le navigateur.
- **Le numéro de reçu vient de la base** (`FJ-2026-00001`), un numéro par encaissement (lot).
- **Tarifs figés sur l'inscription** : changer le tarif d'une classe ne touche pas les élèves déjà inscrits.
- **Chaque école ne voit que ses données** : RLS par claims JWT, plus un filtre `ecole_id` dans chaque requête.
- **Mobile d'abord**, interface en français, fuseau `Africa/Dakar`, montants entiers en FCFA.

## 3. Vue d'ensemble

| N° | Feature | Espace | État |
|---|---|---|---|
| F01 | Ouverture d'un compte école | `/inscription` | Livrée (main) |
| F02 | Connexion de l'école et code d'accès | `/ecole/login`, Paramètres | Livrée (main) |
| F03 | Classes, tarifs et catalogue d'articles | Onglet Classes | Livrée (main) |
| F04 | Inscription d'un élève (atomique, avec encaissement) | Onglet Élèves | Livrée (main) |
| F05 | Fiche élève : suivi et modification | Fiche élève | Livrée (main) |
| F06 | Encaissement et reçu | Fiche élève | Livrée (main) |
| F07 | Annulation d'un reçu | Fiche élève, Paiements | Livrée (main) |
| F08 | Dernier mois payé par tranches | Paramètres, Fiche élève | Livrée (main) |
| F09 | Articles et services d'un élève | Fiche élève | Livrée (main) |
| F10 | Départ d'un élève (abandon, transfert) | Fiche élève | Livrée (main) |
| F11 | Journal des paiements | Onglet Paiements | Livrée (main) |
| F12 | Impayés et relance WhatsApp | Onglet Impayés | Livrée (main) |
| F13 | Tableau de bord | Onglet Tableau de bord | Livrée (main) |
| F14 | Paramètres de l'école et passage à l'année suivante | Onglet Paramètres | Livrée (main) |
| F15 | Page parent par lien magique | `/p/[token]` | Livrée (main) |
| F16 | Reçu PDF | `/ecole/recu/[id]`, `/p/[token]/recu/[id]` | Livrée (main) |
| F17 | Export Excel | `/ecole/export` | Livrée (main) |
| F18 | Console SuperAdmin | `/admin` | Livrée (main) |
| F19 | Sécurité et exploitation | Transverse | Livrée (main) |
| F20 | Reprise de l'existant (import Excel) | Onglet Importer | Livrée (main, merge `ccf271e`) |
| F21 | Abonnement appliqué automatiquement (ex-D02) | Espace École, `/admin` | Livrée (main, merge `6c0121d`) |
| D01 à D08 | Features à développer, c'est-à-dire les besoins (D02 livrée, voir F21 ; D03 livrée, voir F07) | — | Voir section 6, fiche à remplir selon la section 8 |
| P01 à P06 | Pistes à trancher | — | Voir section 7 |

## 4. Features livrées

### F01 — Ouverture d'un compte école
- **L'école peut** créer son compte seule (nom, responsable, contact, code d'accès) et arrive sur l'onglet Classes.
- **Règles** : essai gratuit de 30 jours ; code de 8 caractères minimum, stocké en bcrypt ; 5 tentatives par IP
  et par quart d'heure ; champ piège contre les robots.
- **Code** : `src/app/inscription/`, `createAdminClient()` (appelant autorisé).

### F02 — Connexion de l'école et code d'accès
- **L'école peut** se connecter avec son identifiant (slug ou e-mail) et son code, se déconnecter, changer son code.
- **Règles** : blocage après 5 échecs (par IP et identifiant) ; changer le code déconnecte les sessions ; une école
  désactivée ne se connecte plus.
- **Code** : `echanger_acces_ecole`, `changer_code_ecole`, `src/lib/ecole-session.ts`.

### F03 — Classes, tarifs et catalogue d'articles
- **L'école peut** créer une classe par année (niveau, frais d'inscription, mensualité, dernier mois), lui attacher un
  catalogue d'articles (tenue, fournitures) et de services mensuels (transport, cantine), obligatoires ou
  optionnels, puis l'archiver.
- **Règles** : classe et catalogue enregistrés en une transaction (`enregistrer_classe`) ; un article déjà payé ne
  change plus de prix ni de quantité ; un article attribué ne change pas de classe.

### F04 — Inscription d'un élève
- **L'école peut** inscrire un élève (nouveau ou déjà connu), rattacher son parent par téléphone, choisir ses
  articles et encaisser à l'inscription, le tout avec un seul reçu.
- **Règles** : une seule transaction (`inscrire_eleve`) : parent, élève, inscription, articles, reçu ; deux enfants
  avec le même téléphone partagent un parent ; matricule attribué par la base ; une inscription par élève et par année.

### F05 — Fiche élève
- **L'école peut** voir la situation d'un élève (grille des mois, arriéré, reste sur l'année, historique par reçu),
  modifier son identité, sa réduction mensuelle, et le supprimer s'il n'a aucun paiement.
- **Règles** : même calcul que le serveur (`src/lib/scolarite.ts`) ; date de dernière modification affichée.

### F06 — Encaissement et reçu
- **L'école peut** encaisser l'inscription, un ou plusieurs mois, un article, un service, un montant partiel ou un
  paiement libre, en espèces, Wave, Orange Money, Free Money, virement ou chèque.
- **Règles** : référence obligatoire pour le mobile money ; montant plafonné au reste dû ; un encaissement = un
  lot = un reçu ; `encaisser_paiement` travaille sous verrou de l'inscription, avec empreinte des paiements lus
  (deux postes ne peuvent pas encaisser deux fois) et clé d'idempotence (double clic sans doublon) ; un service
  mensuel ne s'encaisse pas hors de sa période (bloc v1.16, livré avec F20).

### F07 — Annulation d'un reçu
- **L'école peut** annuler un reçu avec un motif (3 caractères minimum).
- **Règles** : l'annulation porte sur toutes les lignes du reçu ; le reçu reste consultable, barré ; un reçu déjà
  annulé par un autre poste est signalé comme tel.
- **Depuis le bloc v1.19 (ex-D03)** : un paiement ne se supprime plus, même depuis l'éditeur SQL de Supabase (bloc v1.19) ;
  le nettoyage de données de test passe par un drapeau posé dans la transaction.

### F08 — Dernier mois payé par tranches
- **L'école peut** répartir la mensualité du dernier mois en tranches dues avec les mensualités précédentes.
- **Règles** : mois de début et nombre de tranches réglés par l'école ; la tranche due rejoint le reçu de la
  mensualité (case cochée par défaut) ; seules les tranches échues comptent dans l'arriéré.

### F09 — Articles et services d'un élève
- **L'école peut** ajouter à un élève un article ou un service du catalogue de sa classe, puis arrêter un service.
- **Règles** : un service ne s'arrête pas avant son dernier mois payé ; un article vient toujours du catalogue de
  la classe ; les mois payés restent visibles après l'arrêt.

### F10 — Départ d'un élève
- **L'école peut** enregistrer un abandon ou un transfert avec sa date, et revenir à « Inscrit ».
- **Règles** : l'élève ne doit que les mois jusqu'à son départ ; le paiement libre lui est fermé ; le départ est
  visible dans la liste, les impayés, la relance et la page parent.

### F11 — Journal des paiements
- **L'école peut** consulter les paiements regroupés par reçu, filtrés par période (jour, mois, année) et par mode.
- **Règles** : les reçus de reprise n'apparaissent que dans « Toute l'année », avec un badge.

### F12 — Impayés et relance WhatsApp
- **L'école peut** voir les élèves en retard, le total des arriérés, filtrer par classe et ouvrir une relance
  WhatsApp pré-rédigée.
- **Règles** : envoi manuel par lien `wa.me` ouvert par l'école ; le message cite le dû et le lien parent.

### F13 — Tableau de bord
- **L'école peut** voir les élèves inscrits, l'encaissé du jour et du mois, les encaissements par mode, les
  derniers paiements et les plus gros arriérés.
- **Règles** : la reprise de l'existant ne compte ni dans le jour, ni dans le mois, ni par mode.

### F14 — Paramètres et passage à l'année suivante
- **L'école peut** régler sa fiche (nom, adresse sur les reçus), son calendrier (mois de début, nombre de
  mensualités, jour d'échéance), les réglages d'encaissement à l'inscription, et passer à l'année suivante.
- **Règles** : tout est enregistré en une transaction (`enregistrer_parametres`) ; les réglages d'encaissement
  restent au niveau de l'école ; les élèves de l'année précédente apparaissent en « Non réinscrits ».

### F15 — Page parent
- **Le parent peut** suivre tous ses enfants avec un seul lien : mois payés, reste à payer, tranches, reçus.
- **Règles** : page serveur sans JavaScript client (réseau 3G) ; un reçu annulé n'apparaît pas ; l'école peut
  créer un nouveau lien, l'ancien cesse de fonctionner ; un parent ou une école désactivés n'ont plus d'accès.

### F16 — Reçu PDF
- **L'école et le parent peuvent** télécharger le reçu d'un encaissement.
- **Règles** : numéro attribué par la base ; mention « ANNULÉ » ou « Reprise de l'existant » ; plusieurs pages si
  le reçu a beaucoup de lignes.
- **Depuis F20** : un nom d'école, d'élève, de classe ou un libellé trop long est coupé (« ... ») au lieu de
  chevaucher le montant ; au-delà de 300 lignes, le reste est regroupé en « Autres lignes (n) », total exact.

### F17 — Export Excel
- **L'école peut** télécharger un classeur avec les onglets Paiements et Soldes.
- **Règles** : lecture complète (pas de troncature à 1000 lignes) ; textes neutralisés contre les formules.

### F18 — Console SuperAdmin
- **Le SuperAdmin peut** voir les écoles et leurs totaux, changer plan, statut d'abonnement, date de fin, et
  activer ou désactiver une école.
- **Depuis F20** : les totaux sont lus en entier (plus de troncature à 1000 lignes) ; un bandeau prévient
  s'ils sont indisponibles.
- **Depuis F21** : chaque école affiche son état d'abonnement (normal, fin proche, délai de grâce, lecture seule) ;
  le statut « Actif » est refusé sans date de fin, et une école « Actif » sans date est signalée.

### F19 — Sécurité et exploitation (transverse)
- RLS sur toutes les tables, JWT de 5 minutes signé par le serveur, pas de middleware (chaque route se protège).
- Limite de tentatives sur toutes les connexions ; messages d'erreur sans détail technique.
- `/api/diagnostic` protégé par un secret pour contrôler la configuration en production.
- Depuis F20 : en-têtes de sécurité, Content-Security-Policy, ESLint, 356 tests automatiques (Vitest) ;
  message dédié quand une école dépasse le nombre de lignes lisibles ; inscription et import prennent leurs
  verrous dans le même ordre, avec un calcul du matricule unique (bloc v1.19).

### F20 — Reprise de l'existant (import Excel)
- **L'école peut** reprendre en cours d'année ses classes, ses élèves et ce qu'ils ont déjà versé, depuis un
  fichier Excel modèle : aperçu chiffré élève par élève, création des classes et du catalogue, puis import par lots.
- **Règles** : un reçu « Reprise de l'existant » par élève ; période d'un service (arrêt puis reprise) respectée ;
  fichier de 2 Mo au maximum, taille réelle contrôlée ; la reprise reste hors des totaux de caisse.
- **Règles ajoutées après les 7 tranches** : deux périodes d'un service qui se suivent sans mois d'arrêt ne font
  qu'une ligne ; un élève à qui il manque un article obligatoire de sa classe est refusé par la base ; un nom qui
  commence par =, +, - ou @ est refusé ; un lot dont la réponse s'est perdue est signalé « peut-être enregistré »
  et se reprend sans risque.
- **État** : livrée sur `main` le 2026-11-12, merge `ccf271e` (7 tranches, plus les corrections du backlog, commits
  `d38b5f1` et `626d80b`). Schéma relancé en production (blocs v1.16 à v1.19). **Reste à faire** : vérifications en
  production de `docs/mise-en-prod.md` (section 4, « Reprise de l'existant »).

## 5. Dernière feature livrée

### F21 — Abonnement appliqué automatiquement (ex-D02)
- **L'école peut** voir venir la fin de son essai ou de son abonnement (bandeau d'alerte 7 jours avant, bandeau
  rouge pendant les 7 jours de grâce) ; ensuite son Espace École passe seul en lecture seule.
- **Le SuperAdmin peut** voir l'état de chaque école dans `/admin` ; « Actif » exige une date de fin.
- **Règles** : la fin est `trial_ends_at` en essai, `abonnement_fin` en actif (jour de Dakar) ; « Suspendu » ou
  « Expiré » = lecture seule immédiate, sans grâce ; sans date de fin = normal. En lecture seule : consulter,
  reçus PDF, export, relance WhatsApp, lien parent et code d'accès restent permis ; encaisser, annuler un reçu,
  inscrire, modifier (élèves, inscriptions, articles, classes, paramètres) et importer sont refusés. La page
  parent ne change pas ; la case « Active » décochée reste le blocage total. Aucun effet sur les reçus, les
  arriérés ni le reste sur l'année.
- **Où vit la règle** : uniquement en base (`situation_abonnement`, bloc v1.20) ; les triggers
  `trg_abonnement_*` refusent les écritures (FJ403), les écrans et les actions lisent l'état calculé.
- **État** : livrée sur `main` le 2026-11-12, merge `6c0121d` (4 tranches). Bloc v1.20 appliqué en production.
  **Reste à faire** : vérifier le déploiement Vercel.

## 6. Features à développer (identifiées dans le projet)

Un **besoin** est une nouvelle feature à développer : on sait qu'il faut la faire, il reste des points à trancher
avant le plan. Une feature technique sans changement visible pour l'école (D06 à D08) en fait partie.

Chaque ligne cite sa source : demande de l'humain, constat dans le code, ou review (le reviewer la range dans le
bloc « À proposer au feature spec » de son rapport, la session l'ajoute ici après l'accord de l'humain). Aucune
n'a encore de plan `architect`.

| N° | Feature | Ce que l'utilisateur pourra faire | Source | Points à trancher avant le plan |
|---|---|---|---|---|
| D01 | **Changement de classe en cours d'année** | Passer un élève dans une autre classe sans le réinscrire | Règle posée le 2026-11-10 (« on paie d'abord ») | Déjà tranché : seulement si l'élève a soldé son dû à date ; mois passés à l'ancien tarif, nouveau tarif dès le mois du changement. À trancher : sort des articles de l'ancienne classe |

D02 (abonnement appliqué automatiquement) est livrée : voir F21. Son numéro n'est pas réattribué.

## 7. Pistes proposées (à trancher, rien n'est décidé)

Une **piste** est une idée de feature : rien n'est décidé, elle peut être écartée. Une piste validée par l'humain
devient un besoin et passe en section 6. Elles sont classées par valeur estimée pour une école. Une piste repérée
pendant une review arrive ici de la même façon qu'un besoin (bloc « À proposer au feature spec » du rapport,
ajout par la session après l'accord de l'humain), avec sa source dans la colonne « Pourquoi ».

| N° | Piste | Pourquoi | Ce qui existe déjà |
|---|---|---|---|
| P01 | **Plusieurs utilisateurs par école** (directeur, caissier) | Savoir qui a encaissé, limiter l'annulation au directeur | Colonne `paiements.encaisse_par`, un seul code par école |
| P02 | **Réinscription en masse** à la nouvelle année | Réinscrire une classe entière en une fois | Liste « Non réinscrits », réinscription élève par élève |
| P03 | **Relances automatiques** (WhatsApp ou SMS programmés) | Relancer sans ouvrir chaque lien à la main | Relance manuelle `wa.me` (F12) |
| P04 | **Paiement en ligne par le parent** (Wave, Orange Money) | Le parent paie depuis sa page, le reçu est créé seul | Page parent en lecture seule, encaissement saisi par l'école |
| P05 | **Paiement de l'abonnement FayJàng dans l'application** | L'école règle et son abonnement se prolonge seul | Numéro Wave affiché dans Paramètres, statut changé à la main |
| P06 | **Clôture de caisse journalière** | Rapprocher l'encaissé du jour par mode, l'imprimer | Totaux du jour et par mode (F13) |

## 8. Fiche d'une nouvelle feature : modèle et procédure

Une feature n'est planifiée par `architect` qu'avec une **fiche validée par l'humain**. La fiche porte les
décisions métier : elles appartiennent à l'humain. Ni la session principale ni `architect` ne les inventent.

### 8.1 Le modèle

```markdown
### <N°> — <titre fonctionnel>
**Acteur** : école | parent | SuperAdmin
**Ce que l'utilisateur peut faire** : <1 phrase>
**Règles métier** : <liste, avec les décisions déjà tranchées>
**Argent** : <effet sur les soldes, les reçus, les arriérés, ou « aucun »>
**Données** : <tables et colonnes touchées, ou « aucune »>
**Hors feature** : <ce qu'on ne fait pas>
**Critère de done** : <phrase vérifiable en production>
**Exemple chiffré** : <cas de référence pour les tests>
**Questions tranchées** : <question → décision, avec la date>
**Statut de la fiche** : brouillon | validée le <date>
```

### 8.2 Qui renseigne quoi

| Champ | Qui écrit | Qui décide |
|---|---|---|
| Acteur | Session principale, depuis le code | Humain |
| Ce que l'utilisateur peut faire | Humain (la session reformule en une phrase) | Humain |
| Règles métier | Session : règles déjà tranchées + cas ouverts | Humain |
| Argent | Session : effets repérés dans `scolarite.ts` et les fonctions SQL | Humain |
| Données | Session, depuis `.claude/SCHEMA-INDEX.md` et `src/types/database.ts` | — (factuel) |
| Hors feature | Session propose | Humain |
| Critère de done | Session propose | Humain |
| Exemple chiffré | Session propose, avec l'exemple de référence du projet | Humain valide les chiffres |

### 8.3 La procédure, étape par étape

1. **L'humain nomme la feature** en une ou deux phrases (« je veux le changement de classe »). Si elle figure en
   section 6 ou 7, il donne son numéro.
2. **La session principale rassemble l'existant**, sans rien décider :
   - le code concerné (pages, actions, fonctions SQL, calculs de `src/lib`) ;
   - les décisions déjà prises : sections 2 et 9 de ce document (« Décisions tranchées »), mémoire du projet ;
   - les bugs ouverts de `BACKLOG.md` que la feature croise (champ « Croise : »).
3. **La session rédige un brouillon de fiche** (statut « brouillon »). Les champs factuels sont remplis ; chaque
   point non décidé est écrit **« À trancher »**, jamais deviné.
4. **La session pose les questions métier ouvertes**, toutes en une fois : une question précise, deux options
   avec leurs conséquences (sur l'argent d'abord), et une recommandation. Quatre questions au plus par tour ; s'il
   en reste, c'est que la feature est trop large et doit être coupée en deux fiches.
5. **L'humain tranche.** La session reporte chaque réponse dans « Questions tranchées » avec la date, et met à jour
   les règles métier. Une réponse qui crée une nouvelle question relance l'étape 4.
6. **La session propose l'exemple chiffré** : un cas complet avec les montants attendus (reçu, arriéré, reste sur
   l'année), bâti sur l'exemple de référence (mensualité 20 000, 9 mensualités d'octobre à juin, échéance le 5).
   L'humain vérifie les chiffres à la main : ce sont eux qui serviront aux tests.
7. **L'humain valide la fiche** (« fiche validée »). La session passe le statut à « validée le <date> », ajoute la
   fiche à la suite de ce document, et met à jour la ligne de la feature dans la vue d'ensemble (section 3).
8. **La fiche part chez `architect`**, copiée telle quelle, avec les bugs du backlog croisés. Il produit le
   plan en tranches verticales (`.claude/WORKFLOW.md`).

### 8.4 Quand la fiche est prête

Une fiche est validable seulement si :

- [ ] plus aucun « À trancher » ;
- [ ] le champ **Argent** dit l'effet sur le reçu, l'arriéré et le reste sur l'année, ou « aucun » ;
- [ ] **Hors feature** contient au moins une exclusion (sinon le périmètre n'est pas borné) ;
- [ ] le **critère de done** se vérifie en production par quelqu'un de l'école, sans lire le code ;
- [ ] l'**exemple chiffré** a été recalculé à la main par l'humain ;
- [ ] aucune règle ne contredit `CLAUDE.md` ni une décision tranchée (sinon : la rouvrir explicitement d'abord).

### 8.5 Après la validation

- **Question découverte pendant le plan** : `architect` ne décide pas, il la met dans sa section « Escalade ».
  L'humain répond, la session complète « Questions tranchées » de la fiche, puis le plan est repris.
- **Règle qui change en cours de feature** : on modifie la fiche d'abord (avec la date), le plan ensuite. La
  fiche reste la référence du « quoi ».
- **Feature livrée** : la fiche passe en section 4 (features livrées), réduite à « ce que l'utilisateur peut
  faire » et « règles » ; les décisions durables sont recopiées en section 9 « Décisions tranchées »,
  avec l'accord de l'humain.

## 9. Décisions tranchées (ne plus rouvrir)

Décisions métier, décisions de projet et risques acceptés, tranchés par l'humain. Une décision ne se rouvre pas
sans raison nouvelle ; une fiche qui en contredit une doit d'abord la rouvrir explicitement (section 8.4). La
session ajoute une ligne ici après l'accord de l'humain, avec la date. Les bugs corrigés, eux, sont dans
`BACKLOG.md` (« Bugs corrigés »).

- **Un paiement ne se supprime ni ne se modifie** : annulation motivée seulement,
  reçu barré « ANNULÉ », annulation par reçu entier (lot). (2026-11-07)
- **Le dernier mois peut se payer par tranches** : mois de début et nombre de
  tranches réglés par l'école, tranche incluse dans le reçu de la mensualité, case
  cochée par défaut. (2026-11-08)
- **Commits signés avec l'adresse noreply GitHub** dans ce dépôt (l'adresse Gmail
  n'est pas reliée au compte, Vercel refusait le déploiement). (2026-11-08)
- **Nom de l'application : FayJàng** (identifiants techniques sans accent :
  `fayjang`). (2026-11-08)
- **Réglages d'encaissement fixés par l'école en début d'année** (1er / dernier mois à
  l'inscription, mois payé par tranches) : ils restent au niveau de l'école, pas figés sur
  chaque inscription. (2026-11-08)
- **Départ d'un élève (abandon, transfert)** : une date de départ est enregistrée ; les mois
  jusqu'au mois du départ inclus (mois entamé = dû) restent dus, ceux d'après ne le sont plus
  (ce qui est déjà payé est gardé, pas de remboursement). Restent dus : frais d'inscription,
  frais uniques (tenues…), 1er mois payé à l'inscription. Anciens abandons sans date : ancien
  calcul + bandeau « date de départ manquante ». Le parent voit « Départ enregistré le … ». (2026-11-08)
- **Paiement libre refusé pour un élève parti** (abandon ou transfert). Appliqué dans
  `encaisserPaiement` et l'interface (commit `3e3c4bb`). (2026-11-08)
- **Exception au gel du schéma** pour la seule colonne `inscriptions.date_depart` (ajout pur,
  feature « départ d'un élève »). (2026-11-08)
- **Préfixe des reçus encore « JP- »** — vient de l'ancien nom JàngPay. Passer à
  « FJ- » demande un bloc final qui remplace `numeroter_recu` .(2026-11-09)
- **Signature de `inscrire_eleve` gardée en tranche 2** — mêmes 14 paramètres, refus de l'encaissement
  retiré, lignes de paiement validées avant tout cast. Commit `865f9d2`. (2026-11-10)
- **Parent existant à l'inscription** : même téléphone dans l'école = même parent ; son nom et son lien
  ne changent pas (un parent désactivé est réutilisé sans être réactivé). (2026-11-10)
- **Service d'un élève parti sans aucun versement : c'est un dû** (M-A) — tranché par l'humain : `repartirReprise`
  rattache le service, obligatoire ou optionnel, pour le mois du départ, avec un avertissement. Commit `0c83e9d`. (2026-11-11)
- **`bodySizeLimit: "3mb"` vaut pour toutes les Server Actions : risque accepté** — `next.config.ts` : Next 15 n'a
  pas de réglage par action, le corps (3 Mo au lieu de 1) est mis en mémoire avant le contrôle de session. Accepté
  pour l'import (2 Mo + enveloppe multipart). À rouvrir seulement si Next permet une limite par route.
  (review security tranche 2 « reprise de l'existant », 2026-11-11 ; rangé ici le 2026-11-12)

## 10. Fiches validées (features en cours)

Fiches validées par l'humain selon la section 8, en attente de plan ou en cours de développement. Une fiche
livrée quitte cette section pour la section 4 (section 8.5).

Aucune fiche en cours. La dernière (D02) est livrée : voir F21.
