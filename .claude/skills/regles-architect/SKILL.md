---
name: regles-architect
description: >
  Règles de planification feature-specific pour FayJàng. Charger ce
  skill dès qu'on planifie une fonctionnalité, qu'on découpe une demande
  en tranches verticales, ou qu'on définit le scope d'une review. Contient
  la cartographie du projet, la matrice scope → reviewer, les règles de
  découpage vertical et un exemple de plan feature-specific complet.
---

# Règles de planification feature-specific — FayJàng

## Entrée du plan : la fiche de feature

Un plan part d'une **fiche validée** de `docs/feature-spec.md` (section 8) :
acteur, ce que l'utilisateur peut faire, règles métier, argent, données, hors
feature, critère de done, exemple chiffré, questions tranchées.

| Champ de la fiche | Devient dans le plan |
|---|---|
| Ce que l'utilisateur peut faire | Titre et « critère de done global » |
| Règles métier, questions tranchées | Contraintes de chaque tranche (citées, pas reformulées) |
| Argent | Zones à risque 🔴 et tests où reçu, arriéré et reste sont vérifiés |
| Données | Fichiers et scope de `database-reviewer` |
| Hors feature | « Hors feature » et « Ce que le plan NE fait PAS » |
| Exemple chiffré | Tests manuels et tests Vitest de chaque tranche |

La fiche dit le **quoi**, le plan dit le **comment**. Si le découpage révèle
une question que la fiche ne tranche pas, elle va en `## Escalade` : on
corrige la fiche d'abord, le plan ensuite.

## Principe

Un plan **feature-specific** découpe une fonctionnalité en **tranches
verticales livrables**, chacune avec un **scope explicite** donné aux
reviewers. Ce n'est PAS un plan "par couche" (schéma → serveur → client).

**Différence clé :**

| Plan role-based (refusé) | Plan feature-specific (attendu) |
|---|---|
| T1 schéma · T2 policy · T3 serveur · T4 client | T1 "l'école enregistre une relance pour UN parent" (schéma + policy + action + UI minimale) |
| Reviews : "database-reviewer sur le schéma" | Reviews : "database-reviewer sur la table `relances` UNIQUEMENT" |
| Critère : "la policy est écrite" | Critère : "l'école relance un parent, la relance apparaît dans la fiche élève, en prod" |

## Cartographie (pour référence)

### Routes et rôles

| Route | Rôle | Auth |
|---|---|---|
| `/admin/**` | SuperAdmin | Cookie `fayjang_admin` (code `SUPERADMIN_CODE`), client admin |
| `/ecole/**` | Direction / comptabilité d'une école | Cookie `fayjang_ecole` → JWT court `role_app='ecole'` |
| `/p/[token]` | Parent | Token URL → JWT court `role_app='parent'` (`parent_id`, `ecole_id`) |
| `/inscription` | Nouvelle école | Public, client admin (l'école n'existe pas encore) |
| `/api/diagnostic` | Exploitation | En-tête `x-diagnostic-secret`, 404 sinon (en production) |

### Fichiers critiques

| Fichier | Review obligatoire (avec scope) |
|---|---|
| `supabase/schema/*.sql` (5 sources ; `schema.sql` est **généré**) | `database-reviewer` sur les objets modifiés UNIQUEMENT. Une migration = un nouveau bloc `vX.Y` en fin de `05-migrations.sql`, jamais un bloc existant modifié |
| `src/types/database.ts` | Mis à jour par le dev **dans le même commit** que le schéma, après accord explicite de l'humain (pas de génération CLI) |
| Fonctions SQL atomiques : `inscrire_eleve`, `encaisser_paiement`, `enregistrer_classe`, `enregistrer_parametres`, `importer_reprise` | `database-reviewer` sur la fonction nommée. Toute écriture métier en plusieurs lignes passe par une de ces fonctions (une transaction), jamais par plusieurs requêtes depuis l'action |
| `src/lib/supabase/server.ts` | `database-reviewer` (appels `echanger_*`) + `security-reviewer` |
| `src/lib/supabase/admin.ts` | `security-reviewer` |
| `src/lib/supabase/jeton.ts` | `security-reviewer` |
| `src/lib/ecole-session.ts`, `admin-session.ts` | `security-reviewer` |
| Pages et actions de login / inscription (`/ecole/login`, `/admin/login`, `/inscription`) | `security-reviewer` |
| `src/app/**/route.ts` (reçus PDF, export Excel, diagnostic) | `security-reviewer` |
| `src/lib/scolarite.ts` (soldes, arriérés, tranches) | `database-reviewer` sur la fonction modifiée + tests Vitest chiffrés (`scolarite.test.ts`) |
| `src/lib/encaissement.ts` (clé d'idempotence, empreinte, lignes pour la RPC) | `database-reviewer` sur l'appel RPC + tests Vitest |
| `src/lib/reprise-*.ts`, `src/app/ecole/import/` (reprise de l'existant) | `security-reviewer` sur l'action d'import (fichier envoyé par l'école) + `database-reviewer` sur `importer_reprise` |
| `src/lib/recu-pdf.ts`, `recu-donnees.ts` | Vérification visuelle d'un reçu par l'humain (le PDF n'a pas de test automatique) |
| `next.config.ts` (en-têtes de sécurité, CSP) | `security-reviewer` ; toute ressource externe nouvelle doit entrer dans la CSP dans la même tranche |

### Qui code une tranche

| La tranche touche… | Dev |
|---|---|
| Fiche élève, `encaisserPaiement`, `annulerPaiement`, `scolarite.ts`, `encaissement.ts`, reçus PDF | `dev-encaissement` |
| Tout le reste (classes, inscriptions, paramètres, page parent, export, import, tableau de bord, impayés, admin) | Session principale, avec les règles d'un agent dev |

Une tranche qui mélange les deux périmètres est **mal découpée** : la couper.

## Méthode de travail (lire peu, lire juste, prouver)

Un plan faux coûte une tranche entière. Un plan qui lit tout coûte du temps
pour rien. Ordre de lecture, **12 appels d'outils au plus** :

1. La **fiche de feature** (dans la demande, sinon `docs/feature-spec.md`), puis la
   section 9 « Décisions tranchées » du même fichier (`Grep` sur les mots de la feature).
2. `BACKLOG.md` : un seul `Grep` sur les mots de la feature (table, action,
   écran) pour trouver les bugs ouverts « Croise : ».
3. `.claude/SCHEMA-INDEX.md` en entier (court) : tables, fonctions, triggers
   concernés et **dernier bloc `vX.Y`** (le prochain bloc du plan porte le
   numéro suivant). Ne jamais lire `supabase/schema.sql` en entier ; lire la
   plage de la **version active** d'un objet seulement si le plan en dépend.
4. Un `Grep` groupé sur le code (`grep -E "nomAction|nomFonction|colonne"`)
   puis `Read` ciblé de l'action ou de la fonction, pas du fichier entier.
5. `Glob` pour vérifier que chaque fichier cité existe.

**Preuves exigées dans le plan** :
- Chaque fichier cité dans une tranche a été vu (`Glob` / `Grep`) ou porte la
  mention **(à créer)**. Aucun chemin inventé.
- Chaque fonction, trigger ou action existante est citée avec son nom exact
  et sa version active (« `encaisser_paiement`, bloc v1.16 »).
- Avant d'écrire « il faut créer X », vérifier que X n'existe pas déjà
  (helper de `src/lib`, fonction SQL, composant de `src/components/ui.tsx`).
- Une affirmation non vérifiée s'écrit « à vérifier par le dev », pas comme un fait.

## Contenu obligatoire d'une tranche

Le dev reçoit **une tranche, copiée telle quelle**, sans le reste du plan :
elle doit se suffire.

| Rubrique | Contenu |
|---|---|
| Ce que l'utilisateur peut faire | 1 phrase, vérifiable à l'écran |
| Qui code | `dev-encaissement` ou session principale (tableau ci-dessus) |
| Règles de la fiche appliquées | Citées mot pour mot, avec la décision tranchée |
| Fichiers | Liste exhaustive, **(à créer)** si nouveau |
| SQL | Fichier source (`0X-*.sql`), numéro du bloc `vX.Y`, objets créés ou remplacés ; « aucun » sinon |
| Effets de bord à traiter | Voir la liste ci-dessous |
| Tests automatiques | Fichier `*.test.ts` et cas chiffrés (ceux de la fiche) |
| Tests manuels | Flow précis en preview, avec les montants attendus |
| Scope des reviews | Objet nommé par reviewer, ou « aucune » avec la raison |
| Porte de sortie | Critère de bout en bout |
| Backlog | Entrées de `BACKLOG.md` résolues par la tranche, par leur titre |

**Effets de bord à vérifier pour chaque tranche** (écrire « aucun » si rien) :
- **Nouvelle colonne de `paiements`** → l'ajouter à la liste `IS DISTINCT FROM`
  de `proteger_paiement` dans le même bloc.
- **Nouvelle table** → `ecole_id`, RLS activée, policies, branche dans
  `verifier_meme_ecole` + `trg_meme_ecole`, `REVOKE` par défaut.
- **Nouvelle fonction SQL** → `search_path`, `REVOKE FROM PUBLIC`, contrôle
  du rôle, verrou si elle écrit de l'argent.
- **Nouveau code d'erreur ou nouvelle cause** → message en français dans le
  `RAISE`, code dans `CODES_METIER` (`src/lib/erreurs.ts`), `docs/codes-erreur.md`.
- **Changement de calcul** (`scolarite.ts`) → la fiche élève, la page parent,
  l'onglet Impayés, l'export, la relance WhatsApp et la reprise de l'existant
  (`reprise-repartition.ts`, test de parité) utilisent le même calcul : dire
  lesquels changent.
- **Donnée affichée au parent** → policy `parent_*` correspondante.
- **Schéma** → `src/types/database.ts`, `build-schema.sh`, `schema-index.sh`
  dans la même tranche.
- **Ressource externe côté navigateur** → CSP de `next.config.ts`.

## Mise en production (obligatoire si une tranche touche le schéma)

Le plan se termine par une section « Mise en production » :

- **Ordre** : schéma **avant** le déploiement si le nouveau code lit un objet
  nouveau ; code **avant** le schéma si l'ancien code casserait sur le nouveau
  schéma. Dire lequel, et pourquoi.
- **Compatibilité** : entre les deux étapes, l'application en ligne doit
  continuer de marcher. Sinon le dire et proposer une tranche de transition.
- **Pré-contrôle des données réelles** : si le plan ajoute une contrainte
  (`CHECK`, `UNIQUE`, `NOT NULL`) ou un refus nouveau, fournir la requête
  `SELECT` qui compte les lignes existantes qui la violeraient (0 attendu),
  à lancer en production **avant** la migration.
- **Retour arrière** : ce qu'on fait si la feature doit être retirée (le
  schéma est additif : dire quels objets restent sans gêner).

## Matrice scope → reviewer (le cœur du feature-specific)

Quand une tranche touche à... | Reviewer | Scope à donner EXPLICITEMENT
---|---|---
Une table / colonne / contrainte | `database-reviewer` | "sur la table `<nom>` et ses policies"
Une policy RLS | `database-reviewer` | "sur la policy `<nom>`"
Une fonction SECURITY DEFINER | `database-reviewer` | "sur la fonction `<nom>`"
Un trigger (`numeroter_recu`, `proteger_paiement`, `verifier_meme_ecole`…) | `database-reviewer` | "sur le trigger `<nom>` de la table `<table>`"
Un calcul d'argent (`situationInscription`, tranches) | `database-reviewer` | "sur la fonction `<nom>` de `scolarite.ts` et son appel dans `<action>`"
Une Server Action qui appelle `.rpc()`, ou `.from()` sur une table sensible | `database-reviewer` (en plus de `security-reviewer` sur l'action) | "sur l'appel `<nom>` de l'action `<nom>`"
Une Server Action qui valide des inputs | `security-reviewer` | "sur l'action `<nom>`"
Un cookie / une session | `security-reviewer` | "sur le cookie `<nom>` dans `<fichier>`"
La protection d'une route (pas de middleware : contrôle de session dans chaque fichier) | `security-reviewer` | "sur le contrôle de session de `<fichier>`"
Une route de téléchargement (reçu, export) | `security-reviewer` | "sur la route `<path>`"
Un composant qui affiche une **nouvelle** donnée d'une école ou d'une famille (nouvelle lecture côté serveur) | `security-reviewer` | "sur la lecture de `<page>` et le composant `<nom>`"
L'UI seule (JSX, CSS, libellé), sans nouvelle donnée lue | aucune | —
Un secret (clé, token, hash) | `security-reviewer` + humain | "sur l'usage du secret `<nom>` dans `<fichier>`"

**Règle d'or** : le scope d'une review est toujours un **objet nommé**
(table, policy, fonction, trigger, action, composant, route), jamais une catégorie
("le schéma", "le front", "la sécurité").

## Règles de découpage vertical

### Qu'est-ce qu'une tranche verticale ?

Une tranche verticale traverse **toutes les couches** pour livrer **une
partie fonctionnelle vérifiable**. Elle inclut :

- Le morceau de schéma nécessaire (table, colonne, policy)
- L'action serveur nécessaire
- L'UI minimale nécessaire
- Le test manuel end-to-end

**Elle exclut** : les autres tranches (qui viendront après).

### Exemple de découpage vertical

**Feature** : "Historique des relances d'impayés"

❌ **Découpage role-based (refusé) :**
- T1 — Schéma : table `relances`, policies école + parent
- T2 — Serveur : Server Action école enregistrer relance
- T3 — Client : UI école (onglet Impayés)
- T4 — Client : UI parent
- T5 — Cron SMS

✅ **Découpage feature-specific (attendu) :**
- **T1 — L'école garde la trace d'UNE relance (flow minimal complet)**
  - Schéma : table `relances` (`ecole_id`, `inscription_id`, `arriere`, `canal`, `relance_le`) + policy `ecole_gere_ses_relances` + cas dans `verifier_meme_ecole`
  - Serveur : `enregistrerRelance(inscriptionId)` appelée au clic sur « Relancer »
  - Client : la ligne de l'onglet Impayés affiche « Relancé le 8 nov. »
  - Test : clic « Relancer » → ligne en base avec le bon `ecole_id` → mention visible après rechargement
  - Review : `database-reviewer` sur `relances` + `security-reviewer` sur `enregistrerRelance`

- **T2 — La fiche élève liste les relances**
  - Serveur : lecture via RLS dans `page.tsx`
  - Client : bloc « Relances » dans `fiche-eleve.tsx`
  - Test : 2 relances → 2 lignes datées dans la fiche
  - Review : aucune (lecture seule déjà couverte par la policy de T1)

- **T3 — Relancer toute une classe**
  - Serveur : `enregistrerRelancesClasse(classeId)` (lot)
  - Client : bouton « Relancer les N parents » dans l'onglet Impayés
  - Test : 5 élèves en retard → 5 relances, 0 doublon le même jour
  - Review : `security-reviewer` sur `enregistrerRelancesClasse`

- **T4 (hors scope MVP) — Envoi automatique par SMS**
  - À planifier dans un sprint séparé (fournisseur SMS, coût, consentement des parents)

**Pourquoi c'est meilleur** : T1 est livrable en prod **dès la fin de T1**.
L'école sait déjà qui elle a relancé. T2 ajoute le confort de lecture, T3 la
relance en masse. Si le projet s'arrête après T1, la fonctionnalité est
**partielle mais utile**, pas "à moitié implémentée".

### Taille d'une tranche

- **Cible** : 2h à 6h de travail (plus qu'une tâche role-based, car la
  tranche couvre plusieurs couches).
- **Maximum** : 1 jour. Au-delà, re-découper.
- **Minimum** : un flow utilisateur vérifiable.

### Dépendances entre tranches

- **Séquentielles** : T2 dépend de T1 (on ne liste pas des relances qui
  n'existent pas). À ordonner.
- **Parallélisables** : T2 et T3 peuvent être faites en parallèle après T1
  si leurs fichiers sont disjoints. À signaler dans le plan.
- **Indépendantes** : rare dans une feature, mais possible.

## Portes de sortie : critère end-to-end

Une porte de sortie de tranche n'est pas "le code est écrit" ni "la policy
est créée". C'est un **critère vérifiable par un humain en prod ou en dev**.

❌ "T1 — table relances créée. Porte : la table existe."
✅ "T1 — l'école relance UN parent. Porte : login École → onglet Impayés →
clic 'Relancer' sur Awa → `SELECT * FROM relances` montre 1 ligne avec la
bonne `inscription_id` et le bon `ecole_id` → l'UI affiche 'Relancé le …'."

**Pour l'argent**, la porte de sortie cite toujours des montants : "Moussa
(mensualité 20 000, juin en 3 tranches) : encaisser janvier → reçu unique de
26 666 FCFA, arriéré 0, reste sur l'année 133 334."

## Exemple de plan feature-specific complet

**Demande** : "Permettre de payer plusieurs enfants d'une même famille sur un seul reçu."

```markdown
# Plan — Reçu famille (plusieurs enfants, un paiement)

## Scope strict
**Dans la feature** :
- Lot de reçu partagé entre plusieurs inscriptions d'un même parent
- Trigger `numeroter_recu` (règle « un reçu = un élève » à assouplir en « un reçu = un parent »)
- Action `encaisserPaiementFamille`
- UI : bouton « Encaisser pour la famille » dans la fiche élève (frères et sœurs du même parent)
- Reçu PDF : une section par enfant + total famille

**Hors feature (sprints séparés)** :
- Paiement en ligne par le parent (Wave API)
- Remise famille automatique (déjà gérée par la réduction mensuelle)

**Critère "done" global** : un parent de 2 enfants paie janvier pour les deux et
reçoit un seul reçu numéroté avec le détail par enfant.

## Zones à risque
- 🔴 `numeroter_recu` : un lot ne doit jamais mélanger deux parents ni deux écoles
- 🟠 Annulation : annuler le reçu annule les lignes des deux enfants
- 🟡 Page parent : chaque enfant doit continuer de voir ses lignes

## Tranches verticales

### Tranche 1 — Encaisser la même mensualité pour deux enfants, un reçu
**Après cette tranche** : l'école encaisse janvier pour Awa et Moussa en une fois.
**Qui code** : `dev-encaissement` (fiche élève, encaissement)
**Règles de la fiche appliquées** : « un reçu famille ne concerne qu'un seul parent » (tranché le …)
**Fichiers** : `supabase/schema/05-migrations.sql`, `supabase/schema.sql` et
`.claude/SCHEMA-INDEX.md` (générés), `src/types/database.ts`, `src/app/ecole/actions.ts`,
`src/app/ecole/fiche-eleve.tsx`, `src/lib/encaissement.ts`, `src/lib/encaissement.test.ts`
**SQL** : `05-migrations.sql`, bloc **v1.19** : remplace `numeroter_recu` (un lot = un parent),
crée `encaisser_paiement_famille` (verrou des deux inscriptions, empreinte, clé d'idempotence)
**Effets de bord à traiter** : `annulerPaiement` annule déjà par lot (rien à changer) ;
page parent : chaque enfant garde ses lignes (à vérifier par le dev) ; aucune nouvelle colonne
**Tests automatiques** : `encaissement.test.ts` : lignes des deux enfants, total 40 000
**Scope des reviews** :
- `database-reviewer` : sur `numeroter_recu` (bloc v1.19) et `encaisser_paiement_famille` UNIQUEMENT
- `security-reviewer` : sur `encaisserPaiementFamille` UNIQUEMENT
**Porte de sortie** : 2 lignes de paiement, même `numero_recu`, `lot_id` identique,
`inscription_id` différentes, même `parent_id` → refus si on mélange deux parents
**Tests manuels** :
- [ ] Awa + Moussa (même parent) → 1 reçu de 40 000, arriéré de chacun diminué de 20 000
- [ ] Awa + un élève d'un autre parent → refus clair
- [ ] Double-clic → un seul reçu
**Backlog** : aucune entrée croisée

### Tranche 2 — Le reçu PDF détaille chaque enfant
**Fichiers** : `src/lib/recu-donnees.ts`, `src/lib/recu-pdf.ts`
**Scope des reviews** :
- `security-reviewer` : sur la route `/p/[token]/recu/[id]` (un parent ne voit que ses enfants)
**Porte de sortie** : PDF avec une section par enfant et le total
**Tests manuels** :
- [ ] PDF côté école et côté parent identiques
- [ ] Un autre parent ne peut pas ouvrir ce reçu (404)

## Ordre et dépendances
- T1 avant T2 (le PDF lit le lot créé en T1)

## Mise en production
- **Ordre** : schéma (bloc v1.19) avant le déploiement : le nouveau code appelle `encaisser_paiement_famille`.
- **Compatibilité** : l'ancien code continue d'encaisser un élève à la fois avec le nouveau trigger.
- **Pré-contrôle** : aucun (pas de contrainte nouvelle sur les lignes existantes).
- **Retour arrière** : retirer le bouton ; la fonction reste en base sans effet.

## Ce que le plan NE fait PAS
- Paiement en ligne
- Modification des reçus déjà émis

## Escalade
Un reçu famille annulé annule-t-il les deux enfants d'un coup ? Option A : oui
(un reçu = un document). Option B : annulation par ligne. Recommandation : A,
cohérent avec `annulerPaiement` actuel.
```

## Anti-patterns feature-specific

| Anti-pattern | Correction |
|---|---|
| Tranche "schéma" seule | Inclure l'action + l'UI minimale pour rendre la tranche livrable |
| Review "sur le schéma" | Review "sur la table `relances`" |
| Review "sur le front" | Review "sur le composant `FicheEleve`" |
| Critère "le code est écrit" | Critère "le flow X fait Y en prod", avec des montants |
| Pas de scope strict | Toujours commencer par scope / hors scope |
| Tranche qui touche l'argent sans test chiffré | Ajouter reçu, arriéré et reste sur l'année attendus |
| Tranche qui casse un flow existant sans le dire | Signaler "cette tranche touche le flow d'encaissement" |
| Fichier cité sans l'avoir vu | `Glob` d'abord, ou mention **(à créer)** |
| « Créer un helper X » alors qu'il existe | `Grep` dans `src/lib` avant de proposer |
| Tranche qui dépend du reste du plan pour être comprise | Chaque tranche se suffit : règles, fichiers, tests, reviews |
| Plusieurs requêtes d'écriture depuis l'action pour un même geste | Une fonction SQL atomique (une transaction) |
| Contrainte nouvelle sans regarder les données existantes | Requête de pré-contrôle dans « Mise en production » |
| Tranche à cheval sur `dev-encaissement` et la session principale | La couper en deux tranches |
| Règle métier ajoutée « par bon sens » | `## Escalade`, la fiche d'abord |

## Checklist finale avant de rendre un plan

- [ ] Fiche de feature validée lue (`docs/feature-spec.md`), aucune règle métier ajoutée ou modifiée
- [ ] Scope strict écrit (dans / hors feature), cohérent avec le « Hors feature » de la fiche
- [ ] Exemple chiffré de la fiche repris dans les tests des tranches
- [ ] Critère "done" global en 1 phrase vérifiable
- [ ] Tranches **verticales**, pas par couche
- [ ] Chaque tranche a un critère de sortie **end-to-end**
- [ ] Chaque review a un **scope explicite nommé**
- [ ] Dépendances et parallélisations signalées
- [ ] "Hors feature" explicite
- [ ] Aucune tranche "schéma seule" ou "UI seule"
- [ ] Findings de `BACKLOG.md` croisés par la feature intégrés
- [ ] Chaque tranche a toutes les rubriques de « Contenu obligatoire d'une tranche » et se lit seule
- [ ] Chaque fichier cité a été vu, ou porte **(à créer)** ; versions actives citées
- [ ] « Qui code » renseigné, aucune tranche à cheval sur deux périmètres
- [ ] Effets de bord passés en revue pour chaque tranche (« aucun » écrit si rien)
- [ ] Section « Mise en production » présente si le schéma change (ordre, compatibilité, pré-contrôle, retour arrière)
- [ ] 12 appels d'outils au plus, aucun fichier lu en entier sans nécessité

## Le cycle de livraison (non négociable)

1 tranche = 1 branche de slice = 1 dev = 1 rapport = N reviews = 1 merge vers
la branche de feature. 1 feature = 1 merge vers `main`. Détail : `.claude/WORKFLOW.md`.
