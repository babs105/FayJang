# WORKFLOW — FayJàng

## Le cycle de livraison (non négociable)

**1 tranche = 1 branche de slice = 1 agent dev = 1 rapport = N reviews
= 1 merge vers la branche de feature.**

**1 feature = N tranches = 1 merge vers `main` (donc 1 déploiement prod).**

## Règles

### Sur la fiche de feature (avant le plan)
- **Pas de plan sans fiche validée.** Le « quoi » d'une feature (ce que
  l'utilisateur peut faire, règles métier, effet sur l'argent, hors feature,
  critère de done, exemple chiffré) est écrit dans une fiche de
  `docs/feature-spec.md`, selon la procédure de sa **section 8**.
- **Qui la renseigne** : la session principale rédige le brouillon depuis le
  code et les décisions déjà prises, et pose les questions ouvertes (deux
  options + recommandation). **L'humain tranche et valide.** Aucune règle
  métier n'est inventée, ni par la session, ni par `architect`.
- **La fiche validée est l'entrée d'`architect`**, copiée telle quelle, avec
  les entrées de `BACKLOG.md` que la feature croise.
- **Une règle qui change en cours de feature** se corrige dans la fiche
  d'abord, dans le plan ensuite.
- **Exception** : une correction purement technique tirée de `BACKLOG.md`
  (aucune règle métier, aucun effet sur l'argent) se planifie depuis son
  entrée du backlog, sans fiche.
- `docs/feature-spec.md` est aussi l'inventaire des features (livrées, à
  développer, pistes) : à la fin d'une feature, sa ligne passe à « Livrée ».
- **Qui met à jour `docs/feature-spec.md`** : **la session principale
  seulement, avec l'accord de l'humain.** L'humain décide du contenu, la
  session tient le fichier.

  | Moment | Ce qui change | Accord de l'humain |
  |---|---|---|
  | Nouvelle feature ou piste retenue | Une ligne en section 6 ou 7 | L'humain l'a demandée ou validée |
  | Besoin ou piste signalé par une review ou un dev | Une ligne en section 6 (besoin) ou 7 (piste), avec sa source (review, tranche, date) | Proposée par la session dans le même tour, puis validée |
  | Fiche validée | Fiche ajoutée, ligne à « planifiée » | « fiche validée » |
  | Règle qui change en cours de feature | La fiche, avec la date | Décision de l'humain citée |
  | Correction (backlog ou bug) qui change un comportement décrit | La règle de la feature concernée, marquée « Sur la branche » jusqu'au merge | Proposée par la session dans le même tour, puis validée |
  | Feature mergée sur `main` | Ligne à « Livrée », fiche réduite en section 4 | Merge confirmé |
  | Décision tranchée (métier, projet, risque accepté) | Une ligne datée en section 9 | Décision de l'humain citée |

- **La session propose la mise à jour à chaque changement, sans attendre
  qu'on la lui demande.** Dès qu'un tour modifie un comportement, une règle,
  un statut ou un chiffre décrit dans `docs/feature-spec.md` (feature livrée,
  correction du backlog, bloc de schéma appliqué), la session termine son tour
  en listant les passages du spec devenus faux et en demandant l'accord pour
  les corriger. Elle fait de même pour `BACKLOG.md`. Une correction sans effet
  sur ce que le spec décrit (refactor, typo, test ajouté) ne demande rien.

- **Les agents ne modifient jamais ce fichier.** `architect` et les reviewers
  (lecture seule) signalent dans leur rapport une fiche fausse ou incomplète.
  `dev-encaissement` signale dans son rapport ce qui devrait y changer ; il
  ne l'édite pas (hors de son périmètre).
- **Un besoin (nouvelle feature à développer) ou une piste repéré en review
  va au feature spec, pas au backlog.** Le reviewer le range dans le bloc `## À proposer au feature spec`
  de son rapport, avec sa destination (section 6 « besoin » ou section 7
  « piste »). La session principale reporte la ligne dans la section
  indiquée, après l'accord de l'humain (tri complet : section « Le backlog »).
- Une ligne ne passe à « Livrée » qu'avec la **preuve** (commit de merge sur
  `main`), comme pour une entrée du backlog.

### Sur le plan
- L'architect **ne déclenche rien**. Il écrit un plan. C'est l'humain qui
  déclenche chaque étape.
- Chaque tranche est **verticale** : un peu de schéma, un peu de serveur,
  un peu d'UI, pour livrer un flow utilisateur complet. Pas de "T1 schéma",
  "T2 serveur", "T3 UI".
- Chaque review a un **scope nommé** : "sur la table `paiements`", "sur
  l'action `encaisserPaiement`". Jamais "sur le schéma" ou "sur le front".
- La section **« Ordre et dépendances »** est obligatoire dans chaque plan.
  L'architect y indique pour chaque paire de tranches : séquentielle (raison
  technique) ou parallélisable (preuve que fichiers + SQL + données sont
  disjoints).

### Sur les branches
- **Branche de feature** : `feat/<nom>` (ex: `feat/relances-sms`), créée
  depuis `main` à jour au démarrage de la feature. Vit jusqu'à la fin de
  la feature.
- **Branche de slice** : `feat/<feature>-tN` (ex: `feat/relances-sms-t1`),
  créée depuis la branche de feature pour chaque tranche.
- **Jamais** de commit direct sur `main` pour une feature multi-tranches.
- **Jamais** de merge vers `main` par tranche. Le merge vers `main` se fait
  **une seule fois**, à la fin de la feature.

### Sur le dev
- **Qui code** : une tranche d'encaissement (fiche élève, `encaisserPaiement`,
  `annulerPaiement`, `scolarite.ts`, reçus) va à `dev-encaissement`. **Toute
  autre tranche** (classes, inscriptions, paramètres, page parent, export,
  tableau de bord, impayés) est codée par la **session principale** (Claude),
  avec les mêmes règles qu'un agent dev ci-dessous.
- **Le dev qui code écrit les tests automatiques de sa tranche** (Vitest,
  `src/**/*.test.ts`) : toute logique pure touchée (`src/lib`, calculs, libellés)
  a ses tests, avec les chiffres de l'exemple du plan. `npm test` doit passer
  avant de rendre le rapport ; le rapport liste les tests ajoutés. Les écrans
  restent vérifiés à la main dans la preview.
- Le dev reçoit **une seule tranche** à la fois. Le texte exact copié depuis
  le plan.
- Le dev **ne touche jamais** `supabase/schema/*.sql` **sans autorisation
  explicite de l'humain**. Il propose le bloc SQL dans son rapport. Si
  l'humain répond « applique » (ou équivalent), le dev édite le **fichier
  source concerné** dans `supabase/schema/` (01-tables, 02-securite,
  03-fonctions, 04-triggers, ou 05-migrations), puis lance
  `bash supabase/scripts/build-schema.sh` (régénère `schema.sql`), puis
  `bash scripts/schema-index.sh` (régénère l'index), puis il s'arrête.
  C'est l'humain qui relit le diff (`git diff supabase/schema/ supabase/schema.sql`)
  et applique en base. Sans accord explicite, le dev ne fait que proposer.
- Le dev **met à jour `src/types/database.ts` dans le même mouvement que
  la modification du schéma**, et seulement s'il a l'autorisation explicite
  de l'humain(mode B). Il ajoute les nouvelles colonnes, les nouvelles tables, les
  nouveaux types de retour des fonctions SQL modifiées. Il s'arrête là.
  Sans autorisation, il signale la mise à jour nécessaire dans son rapport.
  L'humain relit le diff (`git diff src/types/database.ts`) avant d'appliquer
  le schéma en base.
- Le dev **ne déclenche pas** les reviews lui-même. Il les liste dans son
  rapport. C'est l'humain qui les invoque.

### Sur le schéma (règle absolue)

- **`supabase/schema.sql` ne bouge que dans le cadre d'une feature planifiée
  par `architect`.** Pas de patch direct. Pas de « tant qu'on y est ».
- **Après chaque modification du schéma**, deux commandes dans cet ordre :
  1. `bash supabase/scripts/build-schema.sh` (régénère `supabase/schema.sql` à partir des 5 fichiers sources)
  2. `bash scripts/schema-index.sh` (régénère `.claude/SCHEMA-INDEX.md`)
- **`supabase/schema.sql` est un fichier généré.** Ne jamais l'éditer à la main.
  Éditer les sources dans `supabase/schema/*.sql`, puis lancer le build.
- **Un finding d'audit ne se corrige pas immédiatement.** S'il n'est pas
  corrigé dans la tranche, il est trié (section « Le backlog ») : un **bug**
  dont la correction est reportée va dans `BACKLOG.md` ; un **besoin** (nouvelle feature à
  développer) ou une **piste** va dans `docs/feature-spec.md` (section 6 ou 7). Dans les deux
  cas il sera planifié, découpé, et suivra le workflow normal.
- **Exception : les 🔴 (fuite active, reçu faux, corruption de données).**
  Hotfix immédiat, branche `fix/prod-xxx` depuis `main`, review accélérée, puis
  retour au workflow.
- **Une seule vague de correction par audit.** Si un audit produit 2 🟠 et
  3 🟡, on applique les 2 🟠 + 1 🟡 (le plus impactant). Les autres 🟡 sont
  triés (bug reporté → backlog, besoin ou piste → feature spec). On ne
  relance pas d'audit après.
- **Si un audit produit 3 findings ou plus, on gèle `schema.sql` pendant
  2 semaines.** On livre une feature utilisateur avant de rouvrir.
- **Qui décide du 🟡 à corriger** : c'est **l'humain**, après lecture du
  rapport. Le reviewer **recommande** (il écrit sur chaque 🟡 soit
  `impact: business`, soit `impact: cosmétique`). Le dev **applique** la
  décision de l'humain. Si l'humain n'est pas disponible dans l'heure :
  **aucun 🟡 n'est appliqué**, tous sont triés (backlog ou feature spec). On
  ne re-audite pas.

  Rappel : un 🟡 `impact: business` est en fait un 🟠 déguisé. Il faut
  le reclasser en 🟠 et l'appliquer. Un 🟡 `impact: cosmétique` est trié :
  au backlog si c'est un bug, sinon au feature spec ou abandonné. Il n'y a
  pas de 🟡 « moyen ».
- **Mise à jour du backlog** : après chaque review, le dev (agent dev ou session principale, ou l'humain)
  ajoute les **bugs** non corrigés à `BACKLOG.md` **avant** de fermer la PR, et la session propose
  les besoins et pistes pour `docs/feature-spec.md`. Un finding non corrigé et non consigné est un
  finding oublié.
- **Lecture du backlog** : `architect` lit `BACKLOG.md` avant chaque plan
  et intègre les bugs que la feature croise comme tranches.
- **Le dev (agent dev ou session principale) gère `BACKLOG.md`, avec l'autorisation de l'humain** :
  - il **ajoute** sans demander les bugs non corrigés de sa tranche (format du fichier : titre,
    problème, correctif, estimation, « Croise ») ; il n'y ajoute **ni besoin, ni piste, ni idée
    d'amélioration** ;
  - il **coche, supprime ou modifie** une entrée, et **la passe en « Bugs corrigés »**, seulement
    après l'accord explicite de l'humain dans la conversation, et en citant la preuve (commit, PR,
    ligne de code) ;
  - une **décision** (métier, projet, risque accepté) ne s'écrit pas dans le backlog : elle va en
    section 9 « Décisions tranchées » de `docs/feature-spec.md`, écrite par la session après l'accord
    de l'humain ;
  - les autres agents (architect, reviewers) n'y écrivent pas.
- **Retrait des findings résolus** : le rapport du dev liste les « findings du backlog résolus » par
  sa tranche, avec le commit. Après accord de l'humain, le dev les passe en « Bugs corrigés » de `BACKLOG.md`
  avant le merge.

### Sur les reviews

#### Comment un reviewer lit (règle de lecture ciblée)

- `database-reviewer` lit **`.claude/SCHEMA-INDEX.md` en premier** (~1k
  tokens), jamais `schema.sql` en entier.
- Il identifie les **sections concernées** par le scope nommé, puis lit
  uniquement ces plages via `Read` avec `offset`/`limit`.
- Il **fusionne les plages contiguës** (1 appel au lieu de 3).
- Il ne lit **pas** les versions mortes (les lignes « remplace Lxxx »).
- Il ne lit les fichiers TypeScript qu'en **grep ciblé**, jamais en entier.
- **Objectif : ≤12 appels d'outils** par review.

**Une review qui lit tout `schema.sql` n'est pas une review ciblée. Elle
est renvoyée.**

#### Avant d'invoquer un reviewer (celui qui invoque : session ou humain)

Les reviewers n'ont que `Read`, `Grep`, `Glob` : ils ne lancent aucune
commande. Celui qui invoque fait donc les contrôles qui demandent un shell,
et écrit le résultat dans sa demande :

- **`database-reviewer`** : `bash supabase/scripts/build-schema.sh && bash scripts/schema-index.sh`,
  puis `git status --short supabase/schema.sql .claude/SCHEMA-INDEX.md`. La
  demande dit « schéma et index régénérés ». Sans cette mention, le reviewer
  refuse la review d'un scope SQL.
- **`security-reviewer`**, si un secret dans le bundle est suspecté :
  `NEXT_DIST_DIR=.next-build npm run build`, pour qu'il puisse chercher dans
  `.next-build/static/`. `npm audit` (S15) est lancé par celui qui invoque.

#### Quelles reviews déclencher (grille proportionnelle)

Le **nombre de reviews** vient d'une seule grille : celle de « Grille de
reviews pour tout agent dev », plus bas, qui compte selon **ce que la tranche
touche**. Le tableau ci-dessous ne fixe que le **niveau de vérification** en
plus des reviews.

| Niveau | Détection | En plus des reviews de la grille |
|---|---|---|
| **Micro** | 1 fichier, pas de SQL, pas d'auth, pas d'argent | `tsc` + `npm test` |
| **Petite** | 2-3 fichiers, UI/logique métier simple | `tsc` + `npm test`, contrôle en preview si un écran change |
| **Moyenne** | Touche SQL ou auth, pattern connu | Tests manuels du flow en preview |
| **Critique** | `schema.sql`, policy RLS, `SECURITY DEFINER`, trigger, cookie, JWT, encaissement, reçu, calcul des soldes | **Tests manuels chiffrés** (reçu, arriéré, reste sur l'année) |

`database-reviewer` est **obligatoire** si la tranche touche :
`schema.sql`, une policy RLS, une fonction `SECURITY DEFINER`, un trigger,
`src/lib/scolarite.ts`, ou une Server Action qui appelle `.rpc()` / `.from()`
sur une table sensible (`ecoles`, `parents`, `eleves`, `inscriptions`, `paiements`).

`security-reviewer` est **obligatoire** si la tranche touche :
`jeton.ts`, `server.ts`, `client-serveur.ts`, une session (`ecole-session.ts`,
`admin-session.ts`), `admin.ts`, une route `**/route.ts` (reçus, export,
diagnostic), une page de login ou d'inscription, `/p/[token]`, ou un nouveau
flow d'auth.

**Une tranche UI pure (couleur, libellé, icône) ne déclenche aucune review.**

#### Grille de reviews pour tout agent dev

**Règle générale** : tout agent dev (présent ou futur : `dev-encaissement`,
`dev-relances`, `dev-espace-parent`, `dev-menu-du-jour`…) applique la
**grille proportionnelle**. Pas de « 2 reviews systématiques ». Chaque
tranche déclenche les reviews selon **ce qu'elle touche**, pas selon
l'agent qui la code.

**Grille** :

| Ce que la tranche touche | Reviews |
|---|---|
| `supabase/schema/*.sql` (policy, trigger, fonction) | **2** (database + security) |
| Un calcul métier sensible (`scolarite.ts` à FayJàng, équivalent ailleurs) | **1** (database) |
| Une Server Action avec inputs (`actions.ts`) | **1** (security) |
| Une Server Action qui appelle `.rpc()`, ou `.from()` sur une table sensible (`ecoles`, `parents`, `eleves`, `inscriptions`, `paiements`) | **2** (security sur l'action + database sur l'appel) |
| Une route de téléchargement (`/ecole/recu/[id]`, `/p/[token]/recu/[id]`, `/export`) | **1** (security) |
| Un cookie, un JWT, une session | **1** (security) |
| L'UI seule (composant, JSX, CSS), sans nouvelle donnée lue côté serveur | **0** (juste `tsc` + `npm test`) |
| Un composant qui affiche une **nouvelle** donnée d'une école ou d'une famille (nouvelle lecture côté serveur) | **1** (security sur la lecture et le composant) |
| Un libellé, une couleur, une icône | **0** (UI pure) |

**Règles de priorité** :

1. Si la tranche touche **`schema.sql` ET `actions.ts`** → 2 reviews
   (les deux domaines sont concernés).
2. Si la tranche touche **un calcul métier ET une route** → 2 reviews
   (database pour le calcul, security pour la route).
3. Si la tranche touche **uniquement l'UI** → 0 review. C'est le cas le
   plus fréquent : ajouter un bouton, changer un libellé, réorganiser un
   formulaire. Le code de l'action est déjà reviewé **quand il a été créé**,
   pas à chaque fois qu'on l'appelle.
4. Si la tranche **ajoute une nouvelle action** dans `actions.ts` (même
   une action apparemment « UI ») → 1 review (security), 2 si l'action
   appelle `.rpc()` ou lit/écrit une table sensible. Avec l'affichage d'une
   nouvelle donnée, ce sont les seuls cas où une tranche UI déclenche une review.

**Critère de décision rapide** : est-ce que la tranche **ajoute ou modifie**
une action, une policy, un trigger, une fonction, un calcul métier, une
route ou une session ? Si oui → review du domaine concerné. Si non (juste
du JSX, du CSS, un libellé) → 0 review.

**Exemples concrets** (valables pour tout agent dev) :

| Tranche | Reviews |
|---|---|
| Ajouter un bouton qui appelle une action **déjà existante et reviewée** | **0** (le bouton est du JSX) |
| Ajouter un champ obligatoire dans une action existante | **1** (security, l'action change) ; **2** si le champ part dans un `.rpc()` ou une table sensible |
| Corriger un calcul métier dans `scolarite.ts` (ou équivalent) | **1** (database) |
| Ajouter une policy + l'action qui l'utilise | **2** (policy + action) |
| Ajouter une nouvelle route de téléchargement | **1** (security) |
| Changer un libellé, une couleur, une icône | **0** (UI pure) |
| Ajouter une **nouvelle** action dans `actions.ts` | **1** (security) ; **2** si elle appelle `.rpc()` ou une table sensible |

Un verdict `BLOQUANT` renvoie au dev sur la même tranche. On ne passe pas à
T(n+1).

### Sur le merge
- **Merge tranche → branche de feature** : dès que la tranche est approuvée
  (reviews + tests sur la preview de la branche de slice). Automatique,
  sans cérémonie.
- **Merge branche de feature → `main`** : **manuel**, une seule fois, après
  validation humaine de l'ensemble de la feature sur la preview Vercel de
  `feat/<feature>`. C'est ce merge qui déclenche le déploiement en
  production.
- Jamais de merge sans les reviews du scope nommé.
- Jamais de merge sans `npx tsc --noEmit` (le hook de fin de tour lance `tsc` puis `npm test`, mais vérifier).
- Jamais de `git push` sur `main` par un agent sans l'accord explicite de l'humain.
- Jamais de merge sans `npm test` vert (tests Vitest écrits par le dev de la
  tranche) ; les écrans restent testés à la main, tests listés dans le rapport du dev.

### Sur le schéma en dev vs prod

- **En dev** : à chaque tranche qui propose un `ALTER`, appliquer
  `supabase/schema.sql` sur la base dev **avant** de tester la tranche sur
  sa preview Vercel.
- **En prod** : **une seule fois par feature**, après le merge
  `feat/<feature>` → `main`, **et seulement si** la feature contient un `ALTER`
  (`git diff main..feat/<feature> -- supabase/schema.sql`).
- **Ordre schéma / déploiement** : en principe, le schéma est appliqué **avant**
  le déploiement quand le nouveau code lit une nouvelle colonne (sinon
  « column does not exist » en production), et **après** quand le code reste
  compatible avec l'ancien schéma. Le rapport du dev précise lequel des deux.
- **Exception `DROP COLUMN`** : vérifier avant le merge que le code déployé
  ne lit plus la colonne (`grep -rn "<nom_colonne>" src/`). Si un seul
  fichier la lit, il faut d'abord une PR qui supprime ces lectures.

## Le backlog (obligatoire)

`BACKLOG.md`, à la racine du projet, est un **backlog de bugs** : il ne
contient que les bugs dont la correction a été reportée. Tout le reste va
dans `docs/feature-spec.md`.

**Tri d'un finding non corrigé dans la PR courante** (le reviewer le propose
dans son rapport, le dev ou la session l'applique) :

| Nature | Critère | Destination | Qui écrit |
|---|---|---|---|
| **Bug reporté** | Le code livré fait autre chose que ce que disent le feature spec, `CLAUDE.md` ou une décision tranchée : résultat faux, refus à tort, erreur, faille exploitable | `BACKLOG.md` | Le dev, sans demander |
| **Besoin** | Une **nouvelle feature à développer** : rien n'est faux aujourd'hui, il manque quelque chose (capacité pour l'école ou le parent, ou feature technique sans changement visible : limite de fréquence, tests SQL) | `docs/feature-spec.md`, section 6 « Features à développer » | La session, après accord de l'humain |
| **Piste** | Idée de feature à valider ou à écarter, rien n'est décidé | `docs/feature-spec.md`, section 7 « Pistes proposées » | La session, après accord de l'humain |
| **Note cosmétique** | Ni bug, ni besoin | Reste dans le rapport, nulle part ailleurs | — |

En cas de doute entre bug et besoin : si aucune règle écrite n'est violée,
ce n'est pas un bug.

Structure de `BACKLOG.md` :

```markdown
# Backlog

## Bugs à planifier (avec architect)
- [ ] **<titre>** (<code checklist, ex. S9, si applicable>) — <description>. Correctif : <…>. *Estimé : <durée>. Croise : <feature>.*

## Bugs mineurs (à corriger quand une feature croise le sujet)
- [ ] **<titre>** (<code checklist, ex. S9, si applicable>) — <description>. Correctif : <…>. *Estimé : <durée>. Croise : <feature>.*

## Bugs corrigés (avec la preuve, ne plus rouvrir)
- [x] **<titre>** — <ce qui est corrigé>. Commit `<hash>`. (<date>)
```

Les décisions tranchées (métier, projet, risques acceptés) ne sont pas dans le backlog : elles sont en
section 9 de `docs/feature-spec.md`.

**Où placer un bug dans le backlog** (le dev applique ce critère, le reviewer peut le suggérer) :
- **Bug à planifier** dès qu'un de ces points est vrai : plus d'1 h de travail, touche `schema.sql`,
  l'auth ou l'argent (encaissement, reçus, soldes), plus de 2 fichiers, ou demande une décision
  métier avant de coder. Ce sont les cas où `architect` est obligatoire.
- **Bug mineur** sinon : correctif court et localisé, appliqué quand une feature passe
  par le fichier.
- Une nouvelle entrée s'ajoute **à la fin** de sa section, avec son origine (review, tranche, date)
  et son code de checklist s'il y en a un (S9, H6…).

## Agents permanents vs agents jetables

### Permanents (compétence transversale)
| Agent | Rôle |
|---|---|
| `architect` | Planifie, découpe en tranches, nomme les scopes de review |
| `database-reviewer` | Audite la couche SQL (RLS, SECURITY DEFINER, triggers, migrations, calcul des soldes) |
| `security-reviewer` | Audite la couche Next.js (cookies, JWT, contrôle de session par route, Server Actions, téléchargements) |

Ces trois agents **ne changent pas** au fil des features. Ils sont stables.

### Jetables (une feature, puis archivés)
| Agent | Feature |
|---|---|
| `dev-encaissement` | Encaissements, reçus, annulations, tranches du dernier mois |
| *session principale* | Tout le reste de l'Espace École, la page parent et l'export (pas un agent : Claude lui-même) |
| `dev-relances` | Relances WhatsApp / SMS des impayés (à créer) |
| `dev-espace-parent` | Page `/p/[token]` (à créer) |
| etc. | |

Un agent dev est créé pour une feature, utilisé le temps des tranches, puis
archivé quand la feature est stable. Le prochain agent dev le remplace.
Chaque agent dev a son skill `regles-dev-<feature>` (invariants, tests, anti-patterns).

**Ne pas créer 10 agents dev d'un coup.** Un seul à la fois, tester le
cycle complet (plan → dev → reviews → merge), puis passer au suivant.

## Alignement avec `CLAUDE.md`

- `CLAUDE.md` = **constitution** : stack, règles de code, vocabulaire,
  Git, comment vérifier un changement. Lu par tous les agents.
- `WORKFLOW.md` = **processus** : qui déclenche quoi, dans quel ordre.
  Lu par l'humain et par `architect`.

En cas de conflit, `CLAUDE.md` gagne. Si le `WORKFLOW.md` contredit
`CLAUDE.md`, corriger le `WORKFLOW.md`.

## Les 6 pièges à éviter

1. **Donner le plan entier au dev.** Il code tout d'un coup, tu perds le
   contrôle, tu ne sais plus quelle tranche a cassé quoi.
2. **Passer à T(n+1) sans avoir mergé Tn dans la branche de feature.**
   Les dépendances entre tranches deviennent floues.
3. **Merger sans les reviews.** Surtout sur `paiements`, `inscriptions`,
   `parents`. Une policy trop large non vue = données d'enfants exposées.
4. **Review générique.** "database-reviewer, regarde le schéma" → il va
   tout relire, rater des choses, et tu vas payer 10× le contexte.
   Toujours un scope nommé.
5. **Laisser le dev déclencher les reviews.** Tu ne vois pas le rapport
   intermédiaire, tu ne peux pas arbitrer, et tu perds la main.
6. **Merger chaque tranche vers `main`.** Si une feature a 3 tranches et
   que chacune va en prod, la prod change 3 fois pour 1 feature.
   **Une feature = un seul merge vers `main`.**

## Checklist avant de demander un plan à l'architect

- [ ] La fiche de la feature existe dans `docs/feature-spec.md` (modèle 8.1)
- [ ] Statut « validée le <date> » : plus aucun « À trancher »
- [ ] Le champ **Argent** dit l'effet sur le reçu, l'arriéré et le reste sur l'année
- [ ] L'exemple chiffré a été recalculé à la main par l'humain
- [ ] Je copie la fiche **telle quelle** dans le prompt de l'architect

## Checklist avant de lancer un dev

- [ ] Le plan de l'architect est validé (scope strict, tranches verticales,
      scopes de review nommés)
- [ ] La branche de feature `feat/<feature>` existe (créée depuis `main` à jour)
- [ ] La branche de slice `feat/<feature>-tN` existe (créée depuis la feature)
- [ ] Je copie **une seule tranche** (Tn) dans le prompt du dev
- [ ] Je précise : "Ne touche à rien d'autre. Ne traite pas les autres tranches."
- [ ] Le dev a bien chargé son skill (`regles-dev-<feature>`)
- [ ] Le dev a lu `CLAUDE.md` et `WORKFLOW.md`

## Checklist avant de merger une tranche (vers la branche de feature)

- [ ] `npx tsc --noEmit` et `npm test` passent (le hook les lance en fin de tour)
- [ ] `database-reviewer` a rendu APPROUVÉ sur son scope nommé (si applicable)
- [ ] `security-reviewer` a rendu APPROUVÉ sur son scope nommé (si applicable)
- [ ] Tests manuels listés dans le rapport du dev : tous passent
- [ ] `.claude/SCHEMA-INDEX.md` régénéré si `schema.sql` a changé
- [ ] Bugs non corrigés ajoutés à `BACKLOG.md`
- [ ] Besoins et pistes des reviews proposés pour `docs/feature-spec.md` (section 6 ou 7)
- [ ] Bugs du backlog résolus par la tranche passés en « Bugs corrigés » (après accord de l'humain)
- [ ] Aucune donnée réelle modifiée sans accord de l'utilisateur
- [ ] Commit au format `type: description en français`
- [ ] Merge `feat/<feature>-tN` → `feat/<feature>`
- [ ] Branche de slice supprimée (`git branch -d feat/<feature>-tN`)

## Checklist avant de merger une feature (vers `main`)

- [ ] Toutes les tranches de la feature sont mergées dans `feat/<feature>`
- [ ] Tests de bout en bout de la feature sur la preview de `feat/<feature>`
- [ ] 4 flows critiques vérifiés : login École, inscription d'un élève,
      encaissement + reçu PDF, page parent
- [ ] `NEXT_DIST_DIR=.next-build npm run build` passe sur la branche de feature
- [ ] Schéma appliqué en production si la feature contient un `ALTER` (ordre précisé par le dev)
- [ ] Aucune donnée réelle modifiée sans accord de l'utilisateur
- [ ] Accord explicite pour le merge vers `main` (c'est un déploiement prod)
- [ ] Merge `feat/<feature>` → `main`
- [ ] `git push` sur `main`
- [ ] `docs/feature-spec.md` mis à jour par la session principale : ligne de la
      feature à « Livrée » avec le commit de merge, fiche réduite en section 4
- [ ] Décisions durables de la fiche recopiées en section 9 « Décisions tranchées » de
      `docs/feature-spec.md` (avec l'accord de l'humain)
- [ ] Branche de feature supprimée

## Exemple complet — feature « relances SMS » (3 tranches)

```bash
# Démarrage de la feature
git checkout main && git pull
git checkout -b feat/relances-sms

# --- Tranche 1 ---
git checkout -b feat/relances-sms-t1
@agent-dev-relances implémente T1
# ... code, rapport, reviews, tests sur preview feat/relances-sms-t1 ...
git add <fichiers-du-scope>
git commit -m "feat: garder la trace des relances d'impayés"
git push -u origin feat/relances-sms-t1
# reviews APPROUVÉ + tests OK
git checkout feat/relances-sms
git merge feat/relances-sms-t1
git push
git branch -d feat/relances-sms-t1

# --- Tranches 2 et 3 : idem ---

# --- Fin de feature : UN SEUL merge vers main ---
# Tests de bout en bout sur la preview de feat/relances-sms
# 4 flows critiques vérifiés
# Accord explicite pour le merge prod
git checkout main && git pull
git merge feat/relances-sms
git push
git branch -d feat/relances-sms
```
