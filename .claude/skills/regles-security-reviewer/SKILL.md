---
name: regles-security-reviewer
description: >
  Règles de revue sécurité front et serveur pour FayJàng (hors SQL).
  Charger ce skill dès qu'on audite un cookie de session, la protection d'une
  route, une Server Action, un JWT, une route de téléchargement (reçu PDF,
  export Excel), un header HTTP, une redirection, ou qu'on vérifie qu'aucun
  secret ne fuit dans le bundle client.
  Contient les checklists S1-S15, les commandes grep et les patterns Next.js + Supabase.
---

# Règles de revue sécurité — FayJàng

## Contexte de sécurité

Deux mécanismes distincts, à ne pas confondre :

1. **Les cookies de session** portent l'identité longue durée. Ils contiennent
   un id, l'heure d'émission et l'expiration, signés en HMAC-SHA256 (`sign()` de
   `src/lib/ecole-session.ts`, secret `ECOLE_SESSION_SECRET`, 32 caractères
   minimum, **sans repli** sur une autre clé). Ils ne contiennent **pas** de JWT.

   | Cookie | Fichier | Contenu | Durée | Flags |
   |---|---|---|---|---|
   | `fayjang_ecole` | `src/lib/ecole-session.ts` | `ecoleId.emisAt.exp.signature` | 30 j | HttpOnly, Secure en prod, SameSite=lax, path `/` |
   | `fayjang_admin` | `src/lib/admin-session.ts` | `superadmin.exp.signature` | 12 h | HttpOnly, Secure en prod, SameSite=strict, path `/admin` |

   `getEcoleId()` vérifie en plus en base (`session_ecole_valide`) que l'école est
   active et que le code n'a pas changé depuis `emisAt` : changer le code
   déconnecte toutes les sessions ouvertes.

2. **Le JWT Supabase** est signé en ES256 par `signerJetonSupabase()`
   (`src/lib/supabase/jeton.ts`, module `crypto` de Node, clé
   `SUPABASE_JWT_PRIVATE_KEY` au format JWK). Il dure 5 min, est re-signé à
   chaque requête et **ne quitte jamais le serveur** : il sert seulement
   d'en-tête `Authorization` vers Supabase. Rôles : `ecole`, `parent`, `connexion`.

L'identifiant de la page parent est dans l'URL (`/p/[token]`, 128 bits hex) et
ré-échangé à chaque requête par `echanger_jeton_parent` (`SECURITY DEFINER`).

**Il n'y a pas de `src/middleware.ts`.** Chaque page, Server Action et route
vérifie elle-même sa session (`getEcoleId()`, `isAdmin()`) ou ré-échange son
token. C'est donc dans chaque fichier que S3 se vérifie.

**Périmètre** : code TypeScript, cookies, headers, protection des routes,
bundle client, Server Actions, routes de téléchargement.
**Hors périmètre** : policies RLS, SECURITY DEFINER, migrations SQL →
escalader vers `database-reviewer`.

**Fichiers critiques :**

| Fichier | Pourquoi |
|---|---|
| `src/lib/supabase/jeton.ts` | Signature JWT ES256, clé privée, durée |
| `src/lib/ecole-session.ts`, `admin-session.ts` | Cookies de session, HMAC, hachage des codes |
| `src/lib/supabase/admin.ts` | Seul fichier qui lit la clé admin |
| `src/lib/supabase/server.ts`, `client-serveur.ts` | Client anon + JWT, fonctions d'échange, contrôle de session |
| `src/app/**/actions.ts` | Points d'entrée appelables depuis le navigateur |
| `src/app/ecole/recu/[id]/route.ts`, `src/app/ecole/export/route.ts`, `src/app/p/[token]/recu/[id]/route.ts`, `src/app/api/diagnostic/route.ts` | Routes HTTP, chacune doit se protéger seule |

---

## 🔴 Critiques (S1-S8)

### S1 — Aucun secret dans le bundle client

Tout ce qui n'est pas préfixé `NEXT_PUBLIC_` ne doit **jamais** apparaître
dans `.next/static/`. Les modules sensibles importent `"server-only"` : un
import depuis un composant client casse le build, ce qui est voulu.

```bash
grep -rln '"use client"' src/ | xargs grep -ln "lib/supabase/jeton\|lib/supabase/admin\|lib/supabase/server\|-session\"\|recu-pdf\|recu-donnees"
# Aucun résultat attendu
grep -L '"server-only"' src/lib/supabase/jeton.ts src/lib/supabase/admin.ts src/lib/supabase/server.ts src/lib/supabase/client-serveur.ts src/lib/*-session.ts src/lib/recu-*.ts
# Aucun résultat attendu
```

`src/lib/scolarite.ts`, `dates.ts`, `libelles.ts`, `whatsapp.ts` et `utils.ts`
sont partagés avec le client **volontairement** (calcul affiché dans la fiche
élève) : ils ne doivent contenir aucun secret ni appel Supabase.

### S2 — Cookie : `HttpOnly`, `Secure`, `SameSite`

```ts
// ✅ modèle de src/lib/ecole-session.ts
cookieStore.set(COOKIE_NAME, `${payload}.${sign(payload)}`, {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  maxAge: SESSION_DURATION_SECONDS,
});
```

**SameSite** : `lax` pour l'école (liens ouverts depuis WhatsApp), `strict`
pour l'admin. `none` interdit. Un nouveau cookie de session doit avoir un
**contenu signé distinct** (préfixe ou format propre) pour qu'une signature
d'un autre cookie ne soit pas réutilisable (`superadmin.` pour l'admin).

### S3 — Chaque route privée vérifie sa session elle-même

Pas de middleware : vérifier dans **chaque** fichier touché.

| Espace | Vérification attendue en tête de page / action / route |
|---|---|
| `/ecole/**` (page, actions, `recu/[id]`, `export`) | `getEcoleId()` (helper `session()` dans `actions.ts`) → sinon redirection `/ecole/login`, `SESSION_EXPIREE` ou 401 |
| `/admin/**` | `isAdmin()` dans la page **et** dans chaque action |
| `/p/[token]` (page, `recu/[id]`) | `echangerJetonParent(token)` → `notFound()` / 404 sinon |
| `/api/diagnostic` | En-tête `x-diagnostic-secret` = `DIAGNOSTIC_SECRET` (16 car. min.), 404 sinon en production |

**Routes publiques assumées** : `/`, `/inscription`, `/ecole/login`,
`/admin/login`.

```bash
# Server Actions École : chaque export doit commencer par session()
grep -n "export async function\|await session()" src/app/ecole/actions.ts
# Actions admin sans isAdmin
grep -n "export async function\|isAdmin()" src/app/admin/actions.ts
# Routes de téléchargement : session vérifiée
grep -n "getEcoleId()\|echangerJetonParent(" src/app/ecole/recu/\[id\]/route.ts src/app/ecole/export/route.ts src/app/p/\[token\]/recu/\[id\]/route.ts
```

### S4 — Clé de signature JWT serveur uniquement

```bash
grep -rn "NEXT_PUBLIC_[A-Z_]*\(SECRET\|KEY\|PRIVATE\)" src/ 2>/dev/null
# Seuls NEXT_PUBLIC_SUPABASE_ANON_KEY et NEXT_PUBLIC_SUPABASE_URL sont autorisés
```

- `SUPABASE_JWT_PRIVATE_KEY` n'est lue que dans `jeton.ts`.
- Le JWT n'est jamais renvoyé au client (pas dans une prop, un cookie, une
  réponse d'action).
- `exp` reste à 5 min (`DUREE_JETON_SECONDES`).

### S5 — Client admin limité aux appelants autorisés

```bash
grep -rln "createAdminClient" src/
# Autorisé UNIQUEMENT dans :
#   - src/lib/supabase/admin.ts (définition)
#   - src/app/admin/** (SuperAdmin)
#   - src/app/inscription/** (ouverture d'un compte école)
#   - src/app/api/diagnostic/** (diagnostic)
# Tout autre match = critique.
grep -rn "SUPABASE_SERVICE_ROLE_KEY" src/
# Attendu : admin.ts, api/diagnostic (présence seulement).
```

Le hook `.claude/hooks/block-service-role.sh` bloque déjà l'écriture de
`service_role` hors de `admin.ts` : un contournement (via Bash, par exemple)
reste un finding.

### S6 — Pas de secret dans les URLs

```ts
// ❌
redirect(`/ecole?session=${valeurCookie}`);
// ✅
await createEcoleSession(ecoleId);
redirect("/ecole");
```

**Exception** : `/p/[token]` porte son identifiant dans l'URL par conception
(lien WhatsApp au parent). Le token doit rester aléatoire (`generateToken()`,
16 octets), révocable (`parents.is_active`, bouton « Nouveau lien ») et la page
reste `noindex`. Les liens de reçu parent (`/p/[token]/recu/[id]`) héritent de
la même règle.

### S7 — Server Actions : validation des entrées et recalcul des montants

Une Server Action est un point d'entrée HTTP : ses paramètres viennent du
navigateur, quel que soit le type TypeScript. Le projet valide **à la main**
(pas de Zod, non installé) :
- `texte()` (trim + longueur maximale) sur les textes ;
- téléphone via `normaliserTelephone()` (`src/lib/telephone.ts`) ;
- montants via `montant()` (entier, 0 à 50 000 000) ;
- valeurs d'énumération contrôlées contre une liste (`MODES_PAIEMENT`, `NIVEAUX`, statuts) ;
- dates via `isDateValide()`, année scolaire via `isAnneeScolaireValide()` ;
- **jamais** d'`ecole_id` ou de `parent_id` d'appartenance reçu en paramètre :
  ils viennent de la session ou de l'échange de token ;
- **jamais** de montant à encaisser cru depuis le client : l'action recalcule
  avec `situationInscription()` et refuse un montant supérieur au reste dû.

```ts
// ✅ modèle École
const s = await session();
if (!s) return { success: false, message: SESSION_EXPIREE };
const nom = texte(saisie.nom, 40);
if (!nom) return { success: false, message: "Indiquez le nom de la classe (ex : CM2 A)." };
```

### S8 — Pas de redirection ouverte

```ts
// ❌
redirect(searchParams.get("next") ?? "/");
// ✅
const next = searchParams.get("next") ?? "/";
redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
```

Aujourd'hui aucune redirection ne dépend d'une entrée : en introduire une est
à vérifier systématiquement.

---

## 🟠 Hautes (S9-S12)

### S9 — Headers de sécurité

À définir dans `next.config.ts` (`headers()`) : `X-Frame-Options: DENY`,
`X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`
(important : les URLs parent contiennent un token), `Permissions-Policy`, et une
CSP compatible avec `https://*.supabase.co`. HSTS : Vercel l'active en production.
**Finding connu** : aucun de ces headers n'est défini aujourd'hui (voir `BACKLOG.md`).

### S10 — Limite de tentatives

- Connexion École : `echanger_acces_ecole` (5 échecs par IP et identifiant, 30 par
  identifiant, 50 par IP, 15 min). L'IP n'est crue que via le JWT `connexion`.
- Console admin : clé `admin`, 5 échecs / 15 min (`loginAdminAction`).
- Inscription d'une école : 5 par IP / 15 min (`inscrireEcoleAction`) + champ piège.
- Codes : 8 caractères minimum (école), 12 (SuperAdmin), stockés en bcrypt en base.

Toute nouvelle surface de connexion doit réutiliser `controler_tentatives` /
`noter_echec_plafonne`. En serverless, un `Map` en mémoire ne suffit pas.

### S11 — Durées

- JWT Supabase : 5 min (`DUREE_JETON_SECONDES`), re-signé à chaque requête.
- Cookie École : 30 jours ; admin : 12 h.
- Tout allongement est une décision à escalader.

### S12 — Logs sans secrets ni données de famille

```bash
grep -rn "console\.\(log\|error\).*\(token\|code\|jeton\|cookie\|telephone\|prenom\)" src/
```

Ne jamais renvoyer `error.message` de Supabase brut au client : passer par
`messageErreur()` (`src/lib/erreurs.ts`), qui ne laisse passer que les codes
métier `FJ4xx` écrits pour l'utilisateur. En local, le code d'erreur est ajouté
au message ; jamais en production.

---

## 🟡 Moyennes (S13-S15)

- **S13** — Erreurs : message générique côté client, détail (code seul) côté serveur.
- **S14** — CSRF : Next.js 15 vérifie `Origin`/`Host` sur les Server Actions ;
  les routes `GET` (reçus, export) ne doivent rien modifier.
- **S15** — `npm audit` avant chaque déploiement.

---

## 🛠️ Commandes de diagnostic rapide

```bash
# 1. Fuites dans le bundle (après NEXT_DIST_DIR=.next-build npm run build)
grep -r "SERVICE_ROLE\|JWT_PRIVATE\|ECOLE_SESSION_SECRET\|SUPERADMIN_CODE" .next-build/static/ 2>/dev/null

# 2. Client admin hors des appelants autorisés
grep -rln "createAdminClient" src/

# 3. NEXT_PUBLIC_ suspects
grep -rn "NEXT_PUBLIC_[A-Z_]*\(SECRET\|SERVICE\|PRIVATE\)" src/

# 4. Cookies posés sans httpOnly
grep -rn "\.set(" src/lib/*-session.ts | grep -v httpOnly

# 5. Redirections construites depuis une entrée
grep -rn "redirect(.*\(searchParams\|formData\|next\)" src/

# 6. Modules serveur importés côté client
grep -rln '"use client"' src/ | xargs grep -ln "lib/supabase/\(jeton\|admin\|server\)\|recu-pdf\|recu-donnees"

# 7. Logs de secrets
grep -rn "console\.\(log\|error\).*\(token\|code\|jeton\)" src/
```

---

## 🎯 Cas de test d'auto-évaluation

Sur le code actuel, l'agent doit relever **au moins** :

1. ✅ Aucun `src/middleware.ts` : protection vérifiée fichier par fichier (S3)
2. ✅ Aucun header de sécurité dans `next.config.ts`, dont `Referrer-Policy` alors que l'URL parent porte un token (S9, finding connu)
3. ✅ `ECOLE_SESSION_SECRET` exigé (32 car. min.), sans repli sur la clé admin (S5, point positif)
4. ✅ `/api/diagnostic` en 404 sans secret en production (S3, point positif)
5. ✅ Cookies de session avec `httpOnly: true` (S2, point positif)
6. ✅ `jeton.ts`, `admin.ts`, `server.ts`, `client-serveur.ts`, `recu-*.ts` importent `"server-only"` (S1, point positif)
7. ✅ Routes de reçu et d'export : session vérifiée et `Cache-Control: private, no-store` (S3, point positif)

S'il rate l'un de ces 7, renforcer la section correspondante.
