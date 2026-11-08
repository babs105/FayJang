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
- `npm run build` : à lancer avant tout push, c'est ce que Vercel exécute
- `npm test` : tests automatiques (Vitest) de la logique pure de `src/lib` (fichiers `*.test.ts` à côté du code). À lancer avant tout push.

## Carte du code

- `src/app/<route>/page.tsx` : composant **serveur** qui lit Supabase et passe les données en props
- `src/app/<route>/*-client.tsx` et `*-panel.tsx` : composants **client** (`"use client"`) avec l'état et les clics
- `src/app/<route>/actions.ts` : Server Actions (`"use server"`) appelées depuis le client
- `src/app/**/route.ts` : téléchargements et API (`/ecole/recu/[id]`, `/ecole/export`, `/p/[token]/recu/[id]`, `/api/diagnostic`)
- `src/lib/` : logique partagée (`dates.ts`, `scolarite.ts` (calcul des soldes), `whatsapp.ts`, `recu-pdf.ts`, `ecole-session.ts`, ...)
- `src/types/database.ts` : types des tables Supabase (des `type`, pas des `interface` : supabase-js exige une signature d'index)
- `supabase/schema.sql` : schéma complet et **idempotent** (relancé en entier dans l'éditeur SQL Supabase)
- `.claude/SCHEMA-INDEX.md` : index du schéma (tables, fonctions, policies, triggers avec leurs lignes), **généré** par
  `bash scripts/schema-index.sh` : à régénérer après chaque modification de `schema.sql`, jamais édité à la main
- `BACKLOG.md` : findings d'audit en attente d'une feature (l'humain et le dev, agent ou session principale, y ajoutent des findings ; seul l'humain coche, supprime ou tranche) ; `docs/mise-en-prod.md` : checklist de mise en production

Espaces : `/ecole` (Espace École, 6 onglets dans `ecole-dashboard-client.tsx` + `fiche-eleve.tsx`), `/p/[token]`
(parent, page serveur sans JS client), `/admin` (SuperAdmin), `/inscription` (ouverture d'un compte école).

## Règles du code
Le processus de livraison (plan → tranche → dev → reviews → merge) est documenté dans `.claude/WORKFLOW.md`.

### Accès à Supabase : RLS + JWT hybride (`src/lib/supabase/`)
Aucune requête ne passe par la clé admin, sauf exceptions ci-dessous. Pattern « token → JWT court » :
l'identifiant reçu est échangé par une fonction SQL `SECURITY DEFINER` (`echanger_*`), puis le serveur signe un JWT
de 5 min en ES256 (`SUPABASE_JWT_PRIVATE_KEY`, importée comme clé de signature dans Supabase) dont les claims
`role_app` (`ecole` | `parent` | `connexion`) / `ecole_id` / `parent_id` filtrent chaque table (section 9 de `schema.sql`).
Le JWT ne quitte jamais le serveur.

| Qui | Client |
|---|---|
| École (cookie de session) | `createClientEcole(ecoleId)` après `getEcoleId()` |
| Connexion École | `echangerAccesEcole(identifiant, code)` |
| Parent `/p/[token]` | `echangerJetonParent(token)` → `{ supabase, parentId, ecoleId }` |
| SuperAdmin, inscription d'une école, diagnostic | `createAdminClient()` (`admin.ts`, contourne la RLS) |

Ne jamais utiliser `createAdminClient()` ailleurs. Le client navigateur (`client.ts`) ne lit rien : pas de politique pour `anon`.

Il n'y a **pas de `src/middleware.ts`** : chaque page, Server Action et route vérifie elle-même sa session
(`getEcoleId()`, `isAdmin()`) ou ré-échange son token. Pas de Zod : entrées validées à la main (`trim`, longueur,
`normaliserTelephone`, `montant()`).

### Server Actions (sécurité)
Toute action École suit ce modèle, dans cet ordre :
1. `const ecoleId = await getEcoleId(); if (!ecoleId) return { success: false, message: SESSION_EXPIREE }` (helper `session()`)
2. `createClientEcole(ecoleId)` puis requêtes **filtrées** par `.eq("ecole_id", ecoleId)` en plus de la RLS
3. `revalidatePath("/ecole")` après une écriture
4. Retour `{ success: boolean; message?: string; data? }`, message en français lisible par l'administration

### Argent
- Montants en FCFA, entiers (`INTEGER`). Formatage : `formatFCFA()`.
- Un paiement **ne se supprime ni ne se modifie** : on l'annule avec un motif (trigger `proteger_paiement`). Le reçu reste, barré « ANNULÉ ».
- Le numéro de reçu (`JP-2026-00001`) est attribué par la base (trigger `numeroter_recu`), jamais par le code.
- Les soldes se calculent avec `situationInscription()` (`src/lib/scolarite.ts`) ; le serveur recalcule toujours avant d'encaisser, il ne croit pas le client.
- Les tarifs sont figés sur l'inscription (`inscriptions.frais_inscription`, `mensualite`) : changer le tarif d'une classe ne touche pas les élèves déjà inscrits.

### Base de données
- Nouvelle colonne ou table : bloc `ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS` dans `supabase/schema.sql`, avant la section 8 ; jamais modifier les blocs existants (skill `/migration-schema`). Puis mettre à jour `src/types/database.ts` et régénérer `.claude/SCHEMA-INDEX.md`.
- Nouvelle table : `ecole_id`, RLS activée et politiques (section 9). Codes d'erreur métier : `JP403`, `JP404`, `JP412`, `JP422`, `JP429` (`src/lib/erreurs.ts`).
- Le schéma est appliqué à la main par l'utilisateur dans Supabase : lui rappeler de le relancer.

### Dates
Fuseau `Africa/Dakar`. Utiliser `todayDakar()` de `src/lib/dates.ts`, jamais `new Date()` brut pour une date métier.
Année scolaire « 2026-2027 », mois des mensualités au format `YYYY-MM-01` (`moisScolaires()`).

### Interface
- Mobile d'abord : la page parent reste légère (serveur seul, réseau 3G/4G).
- Couleur de marque verte (`jang-600`, `#059669`), icônes lucide-react, `cn()` de `lib/utils.ts`, composants de `src/components/ui.tsx`.
- Les envois WhatsApp sont des liens `wa.me` ouverts par l'école (mode manuel).

### Vocabulaire métier
« élève », « parent » (ou tuteur), « inscription », « mensualité », « arriéré », « reçu », « Espace École ».

## Git

- Messages au format `type: description en français` (`feat:`, `fix:`, `refactor:`, `style:`, `docs:`).
- Ne jamais committer `.env.local`, ni `tsconfig.tsbuildinfo`.
- Ne pas pousser sur `main` sans accord explicite : c'est un déploiement en production.
- Ne jamais lire ni afficher le contenu de `.env.local`. Vérifier la config en production : `/api/diagnostic` avec l'en-tête `x-diagnostic-secret`.

## Vérifier un changement

1. `npx tsc --noEmit` (un hook le lance automatiquement en fin de tour si des fichiers .ts/.tsx ont changé), puis `npm test`
2. Si l'interface change : preview `fayjang` (port 3126), sans créer ni modifier de données réelles sans accord
3. Avant un push : `NEXT_DIST_DIR=.next-build npm run build` (ne jamais écrire dans le `.next` du `npm run dev`)

Les skills du projet (`.claude/skills/`) décrivent les tâches courantes : `/migration-schema`, `/verifier`.
Les skills `regles-*` (architect, database-reviewer, security-reviewer, dev-encaissement) sont chargés par les agents de `.claude/agents/`
(`architect`, `database-reviewer`, `security-reviewer` permanents ; `dev-encaissement` pour le flow d'encaissement).
Les autres tranches (classes, inscriptions, paramètres, page parent, export) sont codées par la session principale, avec les règles d'un agent dev (`.claude/WORKFLOW.md`).
