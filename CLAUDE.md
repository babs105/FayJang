# FayJàng

SaaS de suivi de la scolarité pour les écoles privées du Sénégal : inscriptions, mensualités, paiements
(espèces, Wave, Orange Money, Free Money, virement, chèque), reçus PDF numérotés, relances WhatsApp des impayés.
Chaque parent suit la scolarité de ses enfants via un lien magique, sans mot de passe.
Architecture reprise de Cantine Pro (même stack, mêmes règles de sécurité).

Répondre et écrire en **français** : messages, commentaires de code, libellés d'interface, commits.

## Stack

- Next.js 15 (App Router, Server Actions), React 19, TypeScript, Tailwind CSS 3, lucide-react
- Supabase (PostgreSQL) via le server client de `@supabase/ssr` (`createServerClient`), RLS avec politiques par claims JWT
- exceljs (export Excel), pdf-lib (reçus PDF)
- Hébergé sur Vercel ; push sur `main` = déploiement en production

## Commandes

- `npm run dev` : serveur de dev (ou preview `fayjang`, port 3126). L'app exige les clés Supabase de `.env.local`.
- `npx tsc --noEmit` : vérification des types
- `npm run lint` : ESLint (`eslint.config.mjs`, règles Next + TypeScript). 0 erreur attendue ; les `any` volontaires restent en avertissement.
- `npm run build` : à lancer avant tout push, c'est ce que Vercel exécute
- `npm test` : tests automatiques (Vitest) de la logique pure de `src/lib` (fichiers `*.test.ts` à côté du code). À lancer avant tout push.

## Carte du code

- `src/app/<route>/page.tsx` : composant **serveur** qui lit Supabase et passe les données en props
- `src/components/ecole/` : composants **client** (`"use client"`) de l'Espace École (`ecole-dashboard-client.tsx`, `*-panel.tsx`,
  la fiche élève `fiche-*.tsx` + `use-encaissement.ts`, l'import `reprise-*.tsx`) avec l'état et les clics ;
  `src/components/ui/` : composants réutilisables (un fichier par composant, importés depuis `@/components/ui`) ;
  `src/components/admin/` : composants de la console
- `src/app/<espace>/actions/*.ts` : Server Actions (`"use server"`) appelées depuis le client, un fichier par domaine
- `src/app/admin/` : console SuperAdmin, pages `page.tsx` (tableau de bord), `ecoles/` (liste et fiche `?id=`), `abonnements/` ;
  actions dans `actions/` (`session.ts`, `ecoles.ts`, `abonnements.ts`, `stats.ts`) ; `_commun.ts` porte la session SuperAdmin
  (`clientAdmin()`, `chargerEcoles()`), sans rapport avec celle de l'école ; calculs purs dans `src/lib/metier/admin-ecoles.ts`
- `src/app/ecole/actions/` : les actions de l'Espace École, un fichier par domaine (`session.ts`, `classes.ts`, `inscriptions.ts`,
  `eleves.ts`, `encaissement.ts`, `articles.ts`, `parents.ts`, `parametres.ts`, `utilisateurs.ts`, `import.ts`) ; `_commun.ts` porte la
  colle (`session()`, `sessionEcriture()`, `refusDroit()`, `lireEcole()`) et `_import.ts` celle de l'import, **sans** `"use server"`,
  pour ne jamais être appelables du navigateur
- `src/app/**/route.ts` : téléchargements et API (`/ecole/recu/[id]`, `/ecole/export`, `/parent/[token]/recu/[id]`, `/api/diagnostic`)
- `src/lib/` : logique partagée, en cinq dossiers
  - `supabase/` : clients `server.ts` (RLS, JWT école/parent), `client.ts` (navigateur, ne lit rien), `admin.ts` (service_role,
    admin seulement), `jeton.ts` (JWT ES256), `lecture-paginee.ts`
  - `validation/` : saisie des formulaires, téléphone, création d'école, paramètres, fichier de reprise (`reprise-validation.ts` et ses parties)
  - `metier/` : logique **pure** et testée (`scolarite.ts` (soldes), `tranches.ts`, `a-encaisser.ts`, `dates.ts`, `whatsapp.ts`, reprise, ...)
  - `documents/` : PDF et Excel côté serveur (`recu-pdf.ts`, `recu-donnees.ts`, `export-excel.ts`, `export-sur.ts`, `reprise-lecture.ts`)
  - `securite/` : auth et sessions (`ecole-session.ts`, `admin-session.ts`, `session-cookie.ts`), droits, erreurs, mots de passe, `ip.ts`
  - à la racine : `config.ts` (URL de l'app, jetons aléatoires) et `utils.ts` (`cn()`, `formatFCFA()`)
- `src/types/database.ts` : types des tables Supabase (des `type`, pas des `interface` : supabase-js exige une signature d'index) ;
  `src/types/ecole.ts` : données préparées par `/ecole/page.tsx` pour l'Espace École
- `supabase/schema.sql` : schéma complet et **idempotent** (relancé en entier dans l'éditeur SQL Supabase)
- `.claude/SCHEMA-INDEX.md` : index du schéma (tables, fonctions, policies, triggers avec leurs lignes), **généré** par
  `bash scripts/schema-index.sh` : à régénérer après chaque modification de `schema.sql`, jamais édité à la main
- `docs/feature-spec.md` : inventaire des features (livrées, à développer, pistes) et **fiche de feature** à faire valider par l'humain avant tout plan `architect` (procédure en section 8)
- `BACKLOG.md` : backlog des **bugs mineurs** et de la **dette** (`impact: maintien`) dont la correction a été reportée ; après une review, rien d'autre n'est consigné, et ni un reviewer ni un agent dev ne signale de besoin ou de piste (une nouvelle feature vient de l'humain, dans `docs/feature-spec.md`) (géré par le dev, agent ou session principale : il ajoute librement ses bugs non corrigés, mais ne coche, supprime ou modifie qu'avec l'accord explicite de l'humain ; les décisions tranchées sont en section 9 du feature spec) ; `docs/mise-en-prod.md` : checklist de mise en production

Espaces : `/ecole` (Espace École, 7 onglets dans `ecole-dashboard-client.tsx`, dont Importer, + `fiche-eleve.tsx`), `/parent/[token]`
(parent, page serveur sans JS client), `/admin` (SuperAdmin), `/inscription` (ouverture d'un compte école).

## Règles du code
Le processus de livraison (plan → tranche → dev → reviews → merge) est documenté dans `.claude/WORKFLOW.md`.

### Organisation des fichiers (règle)
1. **Un fichier = un domaine, 300 lignes au plus.** Au-delà, on découpe. Jamais de `actions.ts` qui contient tout.
2. **`lib/metier/` et `lib/validation/` = purs** : pas de Next.js, pas de Supabase, pas de session, pas de `revalidatePath`.
   Des calculs, des validations, des messages, testables sans base. Le reste de `lib/` est côté serveur :
   `supabase/` (clients, JWT), `securite/` (auth, sessions, droits, erreurs), `documents/` (PDF, Excel).
3. **`actions/_commun.ts` = colle locale** : session et accès à la base pour ce dossier uniquement, **sans**
   `"use server"`. Le `_` veut dire : « ne m'importe pas depuis un autre dossier ».
4. **Un espace ne touche jamais le `_commun` d'un autre** : École n'importe jamais celui d'Admin, ni l'inverse.
   Seul `lib/` est partagé.
5. **Une fonction utile à 2 dossiers monte dans `lib/`** ; utile à un seul, elle reste dans son `_commun`.
6. **Un dossier de route ne garde que sa page** (`page.tsx`, ou `route.ts` pour un téléchargement) : les Server Actions
   de l'espace vont toutes dans son `actions/`.

### Accès à Supabase : RLS + JWT hybride (`src/lib/supabase/`)
Aucune requête ne passe par la clé admin, sauf exceptions ci-dessous. Pattern « token → JWT court » :
l'identifiant reçu est échangé par une fonction SQL `SECURITY DEFINER` (`echanger_*`), puis le serveur signe un JWT
de 5 min en ES256 (`SUPABASE_JWT_PRIVATE_KEY`, importée comme clé de signature dans Supabase) dont les claims
`role_app` (`ecole` | `parent` | `connexion`) / `ecole_id` / `parent_id` / `utilisateur_id` / `role_utilisateur`
(`directeur` | `caissier`) filtrent chaque table (section 9 de `schema.sql`).
Le JWT ne quitte jamais le serveur.

| Qui | Client |
|---|---|
| Utilisateur de l'école (cookie de session) | `createClientEcole(session)` après `getSessionEcole()` (`getEcoleId()` si seul l'id sert) |
| Connexion École (e-mail + mot de passe) | `echangerUtilisateurEcole(email, motDePasse)` |
| Parent `/parent/[token]` | `echangerJetonParent(token)` → `{ supabase, parentId, ecoleId }` |
| SuperAdmin, inscription d'une école, diagnostic | `createAdminClient()` (`admin.ts`, contourne la RLS) |

Ne jamais utiliser `createAdminClient()` ailleurs. Le client navigateur (`client.ts`) ne lit rien : pas de politique pour `anon`.

Il n'y a **pas de `src/middleware.ts`** : chaque page, Server Action et route vérifie elle-même sa session
(`getEcoleId()`, `isAdmin()`) ou ré-échange son token. Pas de Zod : entrées validées à la main (`trim`, longueur,
`normaliserTelephone`, `montant()`).

### Server Actions (sécurité)
Toute action École suit ce modèle, dans cet ordre :
1. `const session = await getSessionEcole(); if (!session) return { success: false, message: SESSION_EXPIREE }` (helper `session()` de `actions/_commun.ts`)
2. `createClientEcole(session)` puis requêtes **filtrées** par `.eq("ecole_id", ecoleId)` en plus de la RLS
3. `revalidatePath("/ecole")` après une écriture
4. Retour `{ success: boolean; message?: string; data? }`, message en français lisible par l'administration

### Argent
- Montants en FCFA, entiers (`INTEGER`). Formatage : `formatFCFA()`.
- Un paiement **ne se supprime ni ne se modifie** : on l'annule avec un motif (trigger `proteger_paiement`). Le reçu reste, barré « ANNULÉ ».
- Le numéro de reçu (`FJ-2026-00001`) est attribué par la base (trigger `numeroter_recu`), jamais par le code.
- Les soldes se calculent avec `situationInscription()` (`src/lib/metier/scolarite.ts`) ; le serveur recalcule toujours avant d'encaisser, il ne croit pas le client.
- Les tarifs sont figés sur l'inscription (`inscriptions.frais_inscription`, `mensualite`) : changer le tarif d'une classe ne touche pas les élèves déjà inscrits.

### Base de données
- `supabase/schema.sql` est **généré** par `bash supabase/scripts/build-schema.sh`.
  Ne jamais l'éditer à la main. Éditer les fichiers sources dans
  `supabase/schema/*.sql` (01-tables, 02-securite, 03-fonctions, 04-triggers,
  05-migrations), puis lancer le build, puis `bash scripts/schema-index.sh`
  pour régénérer l'index.
- Nouvelle colonne ou table : ajouter le bloc `ADD COLUMN IF NOT EXISTS` /
  `CREATE TABLE IF NOT EXISTS` dans le fichier source concerné (01 pour une
  nouvelle table, 05 pour une migration), **jamais modifier les blocs existants**.
  Puis `bash supabase/scripts/build-schema.sh` pour régénérer `schema.sql`,
  puis `bash scripts/schema-index.sh` pour l'index, puis mettre à jour
  `src/types/database.ts` **dans le même commit** (cohérence obligatoire).
- L'édition d'une source du schéma (`supabase/schema/*.sql`) par un agent dev n'est autorisée qu'après accord explicite de l'humain dans la conversation. L'agent édite la source (nouveau bloc `vX.Y` en fin de `05-migrations.sql`), lance `bash supabase/scripts/build-schema.sh` puis `bash scripts/schema-index.sh`, puis s'arrête. L'humain relit le diff (`git diff supabase/schema/ supabase/schema.sql`) et applique en base. Sans accord, l'agent ne fait que proposer. Deux hooks demandent l'accord à chaque écriture d'un `.sql` (`block-sql-writes.sh` pour Write/Edit, `block-sql-bash.sh` pour une commande shell).
- Nouvelle table : `ecole_id`, RLS activée et politiques (section 9), et le trigger `trg_abonnement_ecriture` (garde d'abonnement, modèle dans `/migration-schema`). Codes d'erreur métier : `FJ403`, `FJ404`, `FJ412`, `FJ422`, `FJ429` (`src/lib/securite/erreurs.ts`).
- Le schéma est appliqué à la main par l'utilisateur dans Supabase : lui rappeler de le relancer.

### Dates
Fuseau `Africa/Dakar`. Utiliser `todayDakar()` de `src/lib/metier/dates.ts`, jamais `new Date()` brut pour une date métier.
Année scolaire « 2026-2027 », mois des mensualités au format `YYYY-MM-01` (`moisScolaires()`).

### Interface
- Mobile d'abord : la page parent reste légère (serveur seul, réseau 3G/4G).
- Couleur de marque verte (`jang-600`, `#059669`), icônes lucide-react, `cn()` de `lib/utils.ts`, composants de `src/components/ui/`.
- Les envois WhatsApp sont des liens `wa.me` ouverts par l'école (mode manuel).

### Vocabulaire métier
« élève », « parent » (ou tuteur), « inscription », « mensualité », « arriéré », « reçu », « Espace École ».

## Git

- Messages au format `type: description en français` (`feat:`, `fix:`, `refactor:`, `style:`, `docs:`).
- Ne jamais committer `.env.local`, ni `tsconfig.tsbuildinfo`.
- Ne pas pousser sur `main` sans accord explicite : c'est un déploiement en production.
- Ne jamais lire ni afficher le contenu de `.env.local`. Vérifier la config en production : `/api/diagnostic` avec l'en-tête `x-diagnostic-secret`.

## Vérifier un changement

1. `npx tsc --noEmit`, puis `npm test` (un hook lance les deux automatiquement en fin de tour si des fichiers .ts/.tsx ont changé)
2. Si l'interface change : preview `fayjang` (port 3126), sans créer ni modifier de données réelles sans accord
3. Avant un push : `NEXT_DIST_DIR=.next-build npm run build` (ne jamais écrire dans le `.next` du `npm run dev`)

Les skills du projet (`.claude/skills/`) décrivent les tâches courantes : `/migration-schema`, `/verifier`.
Les skills `regles-*` sont chargés par les agents de `.claude/agents/` : `architect`, `database-reviewer`, `security-reviewer`
(permanents) ; agents dev jetables `dev-encaissement` (encaissement, reçus, soldes), `dev-inscriptions` (élèves, inscriptions, classes),
`dev-reprise` (import Excel), `dev-comptes` (comptes, droits, abonnement, `/admin`).
Les autres tranches (paramètres, page parent, export, tableau de bord, impayés, cœur d'auth) sont codées par la session principale,
avec les règles d'un agent dev (`.claude/WORKFLOW.md`).
