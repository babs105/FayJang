---
name: regles-database-reviewer
description: >
  Règles de revue PostgreSQL et Supabase pour FayJàng. Charger ce skill
  dès qu'on audite une policy RLS, une fonction SECURITY DEFINER, une migration
  de schéma, un trigger, une Server Action qui appelle .from() sur ecoles /
  parents / eleves / inscriptions / paiements, un calcul de solde de
  src/lib/scolarite.ts, ou une fonction d'échange (echanger_*).
  Contient les checklists C1-C15, H1-H8, M1-M5 avec exemples de code et
  commandes grep prêtes à l'emploi.
---

# Règles de revue database — FayJàng

## Contexte de sécurité (à garder en tête à chaque revue)

FayJàng utilise le **pattern hybride "token → JWT court"** repris de Cantine Pro :
- Pas de Supabase Auth. JWT ES256 signé par le serveur Next.js (`jeton.ts`).
- Claims : `role_app` (`ecole` | `parent` | `connexion`), `ecole_id`, et
  `parent_id` pour un parent.
- Helpers SQL : `jwt_role_app()`, `jwt_ecole_id()`, `jwt_parent_id()`.
- Les identifiants (code École, token parent) sont échangés contre des IDs via
  des fonctions **SECURITY DEFINER** : `echanger_acces_ecole` (JWT `connexion`,
  pas d'`anon`), `echanger_jeton_parent` et `session_ecole_valide` (`anon`).
- La clé admin est **réservée** à `src/lib/supabase/admin.ts`
  (`createAdminClient()`). Elle contourne la RLS. Appelants autorisés :
  `/admin`, `/inscription`, `/api/diagnostic`.
- Le JWT ne quitte jamais le serveur : une policy trop large n'est exploitable
  que si le code serveur sélectionne la donnée. Elle reste un finding (défense
  en profondeur), mais pas une fuite directe vers le navigateur.

**Matrice de scopes :**

| role_app | ecole_id | parent_id | Peut écrire |
|---|---|---|---|
| ecole | ✅ | — | classes, parents, eleves, inscriptions ; paiements en INSERT + annulation |
| parent | ✅ | ✅ | rien (lecture de ses enfants, de leurs inscriptions et paiements non annulés) |
| connexion | — | — | rien (atteste seulement que l'appel de connexion vient de Next.js) |

**Tables sensibles** :
- `acces_ecole` (hash bcrypt du code École) : **aucune policy**, accès par
  `echanger_acces_ecole`, `changer_code_ecole`, `session_ecole_valide`.
- `parents` (`token` du lien magique, téléphone) : lisible par l'école (elle
  envoie le lien) et par le parent lui-même (`parent_lit_sa_fiche`), jamais par
  un autre parent.
- `eleves` (données d'enfants), `paiements` (argent), `inscriptions` (tarifs).
- `compteurs_recus`, `tentatives_connexion`, `schema_migrations` : tables
  système, aucune policy, `REVOKE ALL`.

**Règle d'or de l'argent** : un paiement encaissé ne se supprime jamais et ne se
modifie pas (sauf annulation définitive et motivée). Son numéro de reçu vient de
la base. Une revue qui laisse passer l'un de ces trois points est BLOQUANTE.

---

## Preuve avant finding (règle de fiabilité)

Un finding faux coûte cher : il part au backlog, il est relu, et son correctif
peut casser la production (cas réel du 2026-11-11 : un index unique sur
`(inscription_id, lot_id)` proposé alors qu'un lot a plusieurs lignes et que le
trigger `numeroter_recu` garantissait déjà l'idempotence). Avant d'écrire un
finding, **quatre contrôles** :

1. **Lire le code actif**, pas le déduire. « Rien ne bloque X dans le schéma »
   ne s'écrit qu'après avoir lu les contraintes, les index **et les triggers**
   de la table (`.claude/SCHEMA-INDEX.md` → version active).
2. **Citer la preuve** : chaque finding porte le fichier et la ligne lus. Sans
   ligne citée, ce n'est pas un finding, c'est une hypothèse (section
   « À vérifier », hors verdict).
3. **Rejouer le correctif contre l'existant** : la correction proposée doit
   rester compatible avec les données et les flux actuels (reçu de plusieurs
   lignes, lot annulé, reprise de l'existant, lignes historiques sans `lot_id`).
   Écrire en une phrase le cas normal qui continue de passer.
4. **Relecture externe = hypothèse** : un finding venu d'un autre outil ou
   d'une relecture extérieure se vérifie comme les autres avant d'entrer dans
   le rapport, le backlog ou ce skill.

## 🔴 Critiques (C1-C15) — bloquent le merge

### C1 — RLS activée sur toute table `public`

Toute nouvelle table en `public` doit avoir son
`ALTER TABLE ... ENABLE ROW LEVEL SECURITY` (section 8).

```bash
# Les deux compteurs doivent être égaux
grep -c "^CREATE TABLE IF NOT EXISTS public\." supabase/schema.sql
grep -c "ENABLE ROW LEVEL SECURITY" supabase/schema.sql
```

### C2 — Aucune policy `USING(true)`

Aucune table de FayJàng ne justifie un `USING (true)`. Toute occurrence est refusée.

```bash
grep -n "USING (true)\|USING(true)" supabase/schema.sql
```

### C3 — Aucun secret dans une table avec policy SELECT ouverte à un autre rôle

**Postgres RLS ne filtre pas les colonnes.** Une policy `FOR SELECT` expose
toutes les colonnes de la ligne. C'est pourquoi le code École est dans
`acces_ecole` (sans policy) et pas dans `ecoles`, que le parent peut lire.

```bash
grep -nE "CREATE TABLE|ADD COLUMN" supabase/schema.sql | grep -iE "(token|hash|secret|code_|password|key)"
```

Attendu : `acces_ecole.code_hash` (table sans policy) et `parents.token`
(lisible par l'école et par le parent lui-même seulement). Toute **nouvelle**
colonne secrète dans `ecoles`, `classes`, `eleves`, `inscriptions` ou
`paiements` (tables lisibles par le parent) est bloquante.

```sql
-- ❌ Le parent lirait le code de l'école (ecole_lit_sa_fiche est ouverte au rôle parent)
ALTER TABLE public.ecoles ADD COLUMN IF NOT EXISTS code_wave_api TEXT;

-- ✅ Secret que personne ne lit : table à part, aucune policy
CREATE TABLE IF NOT EXISTS public.secrets_ecole (
    ecole_id UUID PRIMARY KEY REFERENCES public.ecoles(id) ON DELETE CASCADE,
    cle_api TEXT NOT NULL
);
ALTER TABLE public.secrets_ecole ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.secrets_ecole FROM PUBLIC, anon, authenticated;
```

### C4 — SECURITY DEFINER : `SET search_path` obligatoire

Sans ça, un attaquant peut créer un objet homonyme dans un autre schéma et
détourner l'exécution. Les fonctions qui appellent `crypt()` / `gen_salt()`
utilisent `SET search_path = extensions, public` (pgcrypto est dans `extensions`
sur Supabase).

```bash
grep -n "SECURITY DEFINER" supabase/schema.sql
# Chaque occurrence doit porter "SET search_path = public" (ou "extensions, public")
```

### C5 — `REVOKE EXECUTE FROM PUBLIC` obligatoire

Sans REVOKE, la fonction est exécutable par quiconque détient la clé `anon`
(publique par design). Supabase accorde aussi `EXECUTE` à `anon` et
`authenticated` explicitement : les retirer aussi quand ils n'en ont pas besoin.

```bash
grep -n "CREATE OR REPLACE FUNCTION\|REVOKE EXECUTE\|GRANT EXECUTE" supabase/schema.sql
```

Attendu : `anon` n'exécute que `echanger_jeton_parent` et `session_ecole_valide` ;
`echanger_acces_ecole` est réservée à `authenticated` (JWT `connexion`) et
`service_role` ; `changer_code_ecole` à `authenticated` ; les fonctions de
trigger et de tentatives à personne (ou `service_role`).

### C6 — SECURITY DEFINER : vérifier `role_app` + `ecole_id` à l'intérieur

Toute fonction qui **écrit** ou retourne des données d'une école doit vérifier
le scope en début de corps.

```sql
-- ✅ Modèle à suivre (changer_code_ecole)
DECLARE
    v_ecole UUID := public.jwt_ecole_id();
BEGIN
    IF public.jwt_role_app() IS DISTINCT FROM 'ecole' OR v_ecole IS NULL THEN
        RAISE EXCEPTION 'Accès refusé';
    END IF;
    -- ... suite, toujours filtrée sur v_ecole
END;
```

**Exception** : les `echanger_*` (retournent seulement des IDs, n'écrivent
rien d'autre que les compteurs de tentatives).

### C7 — Cohérence multi-écoles : `verifier_meme_ecole`

Une ligne ne doit jamais pointer vers la donnée d'une autre école (élève vers
le parent d'une autre école, inscription vers la classe d'une autre école,
paiement vers l'inscription d'une autre école). La RLS ne le garantit pas : elle
contrôle la ligne écrite, pas la ligne référencée. Le trigger `verifier_meme_ecole`
(version active : **la dernière occurrence dans `schema.sql`**) le fait, avec
**une branche par table** et `NEW` lu **uniquement dans sa branche** (PL/pgSQL
n'a pas de court-circuit : la v1.0 plantait en `42703` en lisant `NEW.parent_id`
sur `inscriptions`).

**Toute nouvelle FK vers une table d'école** doit ajouter sa branche au trigger
et poser `trg_meme_ecole` sur la nouvelle table.

```bash
grep -n "verifier_meme_ecole\|trg_meme_ecole" supabase/schema.sql
```

### C8 — Aucun client admin hors des appelants autorisés

```bash
grep -rn "SUPABASE_SERVICE_ROLE_KEY\|service_role" src/
# Autorisé : src/lib/supabase/admin.ts (et le diagnostic, qui affiche seulement
# si la variable est présente).
grep -rln "createAdminClient" src/
# Autorisé : src/lib/supabase/admin.ts, src/app/admin/*, src/app/inscription/actions.ts,
# src/app/api/diagnostic/*. Tout autre match = critique.
```

### C9 — Fonctions d'échange : `is_active` vérifié

```sql
-- ❌ Le lien d'un parent désactivé, ou d'une école désactivée, fonctionne encore
WHERE p.token = p_token LIMIT 1

-- ✅ (echanger_jeton_parent)
FROM public.parents p JOIN public.ecoles e ON e.id = p.ecole_id
WHERE p.token = p_token AND p.is_active AND e.is_active
```

`echanger_acces_ecole` et `session_ecole_valide` vérifient `ecoles.is_active`.
Une nouvelle fonction `echanger_*` qui ne vérifie que la ligne principale est un finding.

### C10 — Paiements : jamais supprimés, jamais modifiés

- **Aucune policy `DELETE`** sur `paiements`, pour aucun rôle.
- La policy `ecole_annule` (`FOR UPDATE`) n'est sûre **que parce que** le trigger
  `proteger_paiement` (version active : **la dernière occurrence dans `schema.sql`**)
  refuse toute modification hors `annule` / `motif_annulation` / `annule_at` /
  `encaisse_par`, et toute modification d'un paiement déjà annulé.
- **Toute nouvelle colonne métier** sur `paiements` doit être ajoutée à la liste
  `IS DISTINCT FROM` de `proteger_paiement` dans le même bloc (voir H8).
- FK depuis `paiements` : `ON DELETE RESTRICT` (`inscription_id`), jamais `CASCADE`.
  Une inscription qui a des paiements ne se supprime pas (`proteger_inscription`).
- **Idempotence en base** : portée par le trigger `numeroter_recu` (voir H6 et
  C13), pas par un index unique. Ne **jamais** proposer d'index unique sur
  `(inscription_id, lot_id)` : un lot a plusieurs lignes par construction.

```bash
grep -n "ON public.paiements FOR DELETE\|ON public.paiements FOR ALL" supabase/schema.sql   # aucun résultat attendu
grep -n "REFERENCES public.inscriptions(id)" supabase/schema.sql                            # RESTRICT attendu
grep -n "UNIQUE.*lot_id" supabase/schema.sql                                               # aucun résultat attendu
```

### C11 — Limite de tentatives sur les surfaces de connexion

Toute fonction qui valide un identifiant doit implémenter le pattern :

```sql
-- ✅ Modèle à suivre (echanger_acces_ecole)
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended(v_cle, 0));  -- sérialise les tentatives
    PERFORM public.controler_tentatives(v_cle);                  -- lève FJ429 si bloqué
    PERFORM public.controler_tentatives(v_cle_ip);

    SELECT e.id, a.code_hash INTO v_id, v_stocke FROM ... WHERE ...;   -- la ligne d'abord
    IF NOT public.code_correspond(v_stocke, p_code_hash) THEN v_id := NULL; END IF;  -- un seul bcrypt

    IF v_id IS NULL THEN
        PERFORM public.noter_echec_plafonne(v_cle_ip, 5);
        PERFORM public.noter_echec_plafonne(v_cle, 30);
    ELSE
        PERFORM public.effacer_tentatives(v_cle_ip);
    END IF;
    RETURN v_id;
END;
```

**Vérifier :**
- `pg_advisory_xact_lock` en début de transaction (empêche les rafales)
- `controler_tentatives` avant le SELECT
- comparaison par `code_correspond` (bcrypt leurre si identifiant inconnu : pas d'oracle d'existence)
- l'IP n'est crue que si `jwt_role_app() = 'connexion'`
- identifiant normalisé (`lower`, `trim`, `left(...,100)`) et haché (`md5`) dans la clé

### C12 — Tables sans policy (tables "système")

`acces_ecole`, `compteurs_recus`, `tentatives_connexion`, `schema_migrations` n'ont
**aucune policy** par design. Elles doivent être verrouillées **explicitement** :

```sql
ALTER TABLE public.compteurs_recus ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.compteurs_recus FROM PUBLIC, anon, authenticated;
```

**Toute table sans policy est suspecte** : c'est soit une table système
(→ `REVOKE ALL`), soit une table où la RLS a été oubliée (→ critique).

### C13 — Numéro de reçu attribué par la base

- Le numéro `FJ-<année>-<00001>` vient du trigger `numeroter_recu` (version active :
  **la dernière occurrence dans `schema.sql`**), compteur `compteurs_recus` par école
  et par année civile de `paye_le`.
- Les lignes d'un même encaissement partagent `lot_id` et donc le numéro. Un
  `lot_id` n'est réutilisable que **dans la même transaction**
  (`created_at = now()`) et pour **la même inscription** ; sinon `FJ412` / `FJ422`.
- Le code ne doit jamais écrire `numero_recu` (le trigger l'écrase de toute façon)
  ni réutiliser un `lot_id` reçu du client.

```bash
grep -rn "numero_recu" src/app/*/actions.ts   # aucun résultat attendu (seules les actions écrivent)
grep -n "lot_id\|cle" src/app/ecole/actions.ts   # clé reçue du formulaire (lireCleEncaissement), randomUUID() en secours
```

### C14 — Codes d'erreur custom documentés, causes jamais reconnues par leur texte

Les `RAISE EXCEPTION ... USING ERRCODE = 'FJxxx'` sont réservés aux erreurs métier
au message écrit pour l'utilisateur. Liste actuelle : `FJ403` (colonnes réservées
au SuperAdmin), `FJ404` (référence d'une autre école), `FJ412` (paiement ou
inscription verrouillé, reçu déjà émis), `FJ422` (motif d'annulation manquant,
reçu multi-élèves), `FJ429` (trop de tentatives). Chaque code doit être :

1. Documenté dans un commentaire SQL au-dessus de la fonction
2. Listé dans `CODES_METIER` de `src/lib/erreurs.ts` (sinon le message est masqué)
3. Testé en dev

**Un code couvre plusieurs causes, et c'est voulu** : `FJ412` est levé à une
trentaine d'endroits (reçu déjà émis ou annulé, clé d'encaissement réutilisée,
encaissement concurrent, montant au-delà du dû, élève parti, article déjà payé,
classe d'une autre année…). Chaque `RAISE` porte **son propre message en
français**, que `messageErreur()` affiche tel quel : c'est le message qui dit
la cause à l'école. Aucun code TypeScript ne branche aujourd'hui sur la cause
d'un `FJ4xx` (pas de nouvel essai automatique).

- **Ne pas** signaler « `FJ412` fourre-tout » ni réclamer un champ `reason`
  sur les `RAISE` existants : sans consommateur, ce serait du bruit.
- **Est un finding** : du code TypeScript qui reconnaît une cause **par le
  texte** d'un message ou d'une contrainte (`message.includes(...)`,
  `startsWith(...)`) : il casse en silence quand le libellé change. Correctif
  dans cet ordre : un code `FJ4xx` dédié, sinon
  `USING DETAIL = 'reason: <cause>'` lu via `error.details` (jamais affiché),
  sinon le nom **complet** de la contrainte.
- **Est un finding** : deux causes différentes levées avec le **même message**,
  quand l'utilisateur doit agir différemment (recharger et recommencer, ou
  corriger sa saisie).

```bash
grep -n "ERRCODE = 'FJ" supabase/schema.sql
grep -n "CODES_METIER" src/lib/erreurs.ts
grep -n "message.*includes(\|message.*startsWith(\|erreur\.startsWith(" src/app/*/actions.ts   # cause reconnue par son texte = finding
```

### C15 — Défense en profondeur : REVOKE ALL + ALTER DEFAULT PRIVILEGES

Supabase accorde par défaut **tous les droits** sur une nouvelle table à
`anon` et `authenticated`. La RLS les bloque, mais un REVOKE explicite
protège aussi d'une RLS désactivée par erreur. Le schéma le fait en section 11 :

```sql
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
REVOKE ALL ON public.acces_ecole, public.compteurs_recus, public.tentatives_connexion, public.schema_migrations
    FROM authenticated;
```

Une nouvelle table système doit être ajoutée à la dernière ligne.

---

## 🟠 Hautes (H1-H8) — à corriger avant le prochain sprint

### H1 — `FOR ALL` / `FOR UPDATE` sans `WITH CHECK` = déplacement possible

```sql
-- ⚠️ Un UPDATE peut changer ecole_id et déplacer la ligne vers une autre école
CREATE POLICY p ON public.eleves FOR ALL TO authenticated USING (ecole_id = public.jwt_ecole_id());

-- ✅ (modèle ecole_gere_ses_eleves)
CREATE POLICY ecole_gere_ses_eleves ON public.eleves FOR ALL TO authenticated
    USING (public.jwt_role_app() = 'ecole' AND ecole_id = public.jwt_ecole_id())
    WITH CHECK (public.jwt_role_app() = 'ecole' AND ecole_id = public.jwt_ecole_id());
```

### H2 — Isolation `parent_id`

Toute policy au rôle `parent` doit filtrer sur `jwt_parent_id()`, directement ou
par jointure, en plus de `ecole_id = jwt_ecole_id()`.

```sql
-- ⚠️ Un parent verrait les paiements de toute l'école
USING (public.jwt_role_app() = 'parent' AND ecole_id = public.jwt_ecole_id());

-- ✅ (parent_lit_ses_paiements)
USING (public.jwt_role_app() = 'parent' AND ecole_id = public.jwt_ecole_id() AND NOT annule
       AND EXISTS (SELECT 1 FROM public.inscriptions i JOIN public.eleves el ON el.id = i.eleve_id
                   WHERE i.id = paiements.inscription_id AND el.parent_id = public.jwt_parent_id()));
```

`parent_lit_les_classes` et `ecole_lit_sa_fiche` (rôle parent) ne filtrent que
par école : acceptable tant que `classes` et `ecoles` ne contiennent aucune
donnée personnelle ni secret (voir C3).

### H3 — `UNIQUE` sur les colonnes de login et d'identité

- `ecoles.slug` UNIQUE, `ecoles.email_contact` UNIQUE sans casse
  (`idx_ecoles_email`, utilisé par `echanger_acces_ecole`).
- `parents (ecole_id, telephone)` UNIQUE : un téléphone = un parent par école (fratrie).
- `eleves (ecole_id, matricule)` et `inscriptions (eleve_id, annee_scolaire)` UNIQUE.

### H4 — `CHECK` sur les invariants métier

Doivent rester en `CHECK` (pas seulement supposés par le code) :
- montants : `montant > 0`, `frais_inscription >= 0`, `mensualite >= 0`
- `reduction_mensuelle <= mensualite`
- `type <> 'mensualite' OR mois IS NOT NULL`, `mois` au 1er du mois
- énumérations : `type`, `mode`, `statut`, `niveau`, `plan`, `statut_abonnement`
- calendrier : `mois_debut`, `nb_mensualites`, `jour_echeance`, `mois_debut_tranches`, `nb_tranches`

Une contrainte ajoutée sur une table déjà remplie passe par un bloc `DO $$` qui
vérifie `pg_constraint` (idempotence), en `NOT VALID` si des lignes existantes
pourraient la violer.

### H5 — Fonctions SECURITY DEFINER qui écrivent sans vérifier le scope

```sql
-- ⚠️ p_ecole non vérifié contre jwt_ecole_id()
INSERT INTO public.relances (ecole_id, inscription_id) VALUES (p_ecole, p_inscription);

-- ✅ Forcer le scope
INSERT INTO public.relances (ecole_id, inscription_id)
SELECT public.jwt_ecole_id(), p_inscription
WHERE public.jwt_role_app() = 'ecole';
```

### H6 — Idempotence : garantie en base par un trigger, pas seulement dans la fonction

Toute clé d'idempotence (clé de rejeu, `lot_id`, `request_id`) doit être
**garantie par la base** (contrainte ou trigger qui s'applique à tout `INSERT`),
pas seulement vérifiée dans une fonction : sinon un futur chemin d'écriture
(script, migration, endpoint) peut créer un doublon.

**Sur `paiements`, c'est déjà le cas, sans index unique** :
- Un lot = **plusieurs lignes** (plusieurs mois, inscription + mensualité,
  services, reprise de l'existant) qui partagent `inscription_id` et `lot_id`.
  Un index unique sur `(inscription_id, lot_id)` casserait tout encaissement
  de plusieurs lignes : **ne jamais le proposer**.
- La garantie est le trigger `BEFORE INSERT` `numeroter_recu` (version active) :
  un `lot_id` déjà présent et inséré par une **transaction précédente**
  (`created_at <> now()`) lève `FJ412`, quel que soit le chemin d'écriture,
  annulé ou non. Un index partiel `WHERE annule = false` serait plus faible
  (il laisserait rejouer un lot annulé).
- `encaisser_paiement` ajoute par-dessus : rejeu identique → renvoie le reçu
  existant au lieu d'une erreur ; rejeu différent → `FJ412` ; verrou advisory
  `(école, lot_id)`.
- La clé vient du formulaire (`cleEncaissement` dans `fiche-eleve.tsx`, une
  par saisie) : un double clic renvoie la même clé et retombe sur le rejeu.

**Ce qui est un finding** :
- Une nouvelle table avec clé d'idempotence sans contrainte ni trigger en base.
- Un chemin d'écriture sur `paiements` qui insère avec `lot_id IS NULL` (la
  colonne est nullable pour l'historique : une ligne sans lot échappe au
  contrôle). Correctif à proposer : `CHECK (lot_id IS NOT NULL) NOT VALID`,
  après vérification des lignes existantes, pas un index unique.
- Un client qui génère une nouvelle clé à chaque envoi (double clic = deux
  lots, qu'aucun contrôle en base ne peut distinguer).

**Vérifier aussi** :
- Inscription : la réinscription la même année tombe sur l'UNIQUE
  `(eleve_id, annee_scolaire)` → message « déjà inscrit » via
  `messageErreur(..., doublon)`.

### H7 — Index sur les colonnes de `WHERE` / `JOIN`

Vérifier systématiquement qu'un filtre fréquent a son index :
- `paiements(inscription_id)`, `paiements(ecole_id, paye_le)`,
  `paiements(ecole_id, lot_id)`
- `inscriptions(ecole_id, annee_scolaire)`, `eleves(parent_id)`, `*(ecole_id)`

### H8 — Triggers `proteger_*` : toutes les colonnes sensibles couvertes

Un trigger qui protège des colonnes doit les lister **explicitement**. Un trigger
partiel donne une fausse impression de sécurité.

- `proteger_colonnes_ecole` : `slug`, `is_active`, `plan`, `statut_abonnement`,
  `trial_ends_at`, `abonnement_fin` (réservées au SuperAdmin, sans `role_app`).
- `proteger_paiement` : toutes les colonnes de `paiements` sauf l'annulation
  (`annule`, `motif_annulation`, `annule_at`) et `encaisse_par`.

**Test :** ajouter une colonne sensible à une table protégée → modifier le
trigger dans le même bloc final. Un `ADD COLUMN` sans mise à jour du trigger
est un finding.

```bash
grep -n "CREATE OR REPLACE FUNCTION public.proteger_" supabase/schema.sql
```

---

## 🟡 Moyennes (M1-M5) — à corriger dans le mois

- **M1** — `updated_at` : seule `acces_ecole` en a un (sert à invalider les
  sessions). Pas de trigger générique ; à ajouter si une feature a besoin de
  l'historique des modifications (élèves, classes).
- **M2** — Idempotence des migrations :
  - `ADD COLUMN IF NOT EXISTS`
  - `ADD CONSTRAINT` dans un bloc `DO $$ ... pg_constraint ... $$`
  - `CREATE INDEX IF NOT EXISTS`
  - `DROP POLICY IF EXISTS` / `DROP TRIGGER IF EXISTS` avant chaque `CREATE`
  - migration de données dans `schema_migrations`
- **M3** — `REVOKE EXECUTE FROM PUBLIC` sur toute fonction, `GRANT` sélectif.
- **M4** — Reçus : le numéro n'est plus unique par ligne depuis la v1.4 (lots).
  L'unicité d'un reçu repose sur `numeroter_recu` + `lot_id`. Toute écriture
  directe dans `compteurs_recus` ou dans `numero_recu` est un finding.
- **M5** — Aucune donnée de démonstration (école, code, token, élève) dans
  `schema.sql` : le script est relancé en production. Tout seed est bloquant.

---

## 🛠️ Commandes de diagnostic rapide

```bash
# Toutes les policies par table
grep -nE "CREATE POLICY [a-z_]+ ON public\.[a-z_]+ FOR" supabase/schema.sql | \
  sed -E 's/.*ON public\.([a-z_]+).*/\1/' | sort | uniq -c | sort -rn

# Toutes les SECURITY DEFINER
grep -n "SECURITY DEFINER" supabase/schema.sql

# Client admin dans le code Next.js
grep -rn "SERVICE_ROLE\|service_role\|createAdminClient" src/

# Colonnes sensibles
grep -nE "(token|hash|secret|code_|password|key)" supabase/schema.sql | grep -iE "CREATE TABLE|ADD COLUMN|TEXT"

# Limite de tentatives (C11)
grep -n "controler_tentatives\|noter_echec_plafonne\|effacer_tentatives" supabase/schema.sql

# Codes d'erreur custom (C14)
grep -n "ERRCODE = 'FJ" supabase/schema.sql

# Triggers de protection (H8) et cohérence multi-écoles (C7)
grep -n "CREATE OR REPLACE FUNCTION public.proteger_\|verifier_meme_ecole\|CREATE TRIGGER" supabase/schema.sql

# REVOKE ALL sur les tables système (C12)
grep -n "REVOKE ALL ON public\." supabase/schema.sql

# Idempotence (H6) : trigger numeroter_recu présent, aucun index unique sur lot_id
grep -n "Ce reçu est déjà émis" supabase/schema.sql   # FJ412 du trigger attendu
grep -n "UNIQUE.*lot_id" supabase/schema.sql          # aucun résultat attendu

# Cause d'erreur reconnue par son texte (C14)
grep -rn "message.*includes(\|erreur\.startsWith(" src/app/*/actions.ts
```

---

## 🎯 Cas de test d'auto-évaluation

Le skill est correctement calibré si, en le chargeant sur le `schema.sql`
actuel, l'agent trouve **au minimum** :

1. ✅ `acces_ecole` sans policy, `REVOKE ALL` pour anon et authenticated (C3, C12)
2. ✅ Aucune policy DELETE sur `paiements` ; `ecole_annule` couverte par
   `proteger_paiement` (version active), qui liste aussi `lot_id` et `libelle`
   (C10, H8)
3. ✅ `verifier_meme_ecole` : lire la **version active** (la dernière occurrence
   dans `schema.sql`), ne pas signaler les versions mortes listées dans
   `.claude/SCHEMA-INDEX.md` (C7)
4. ✅ `numeroter_recu` : version active, lot réutilisable seulement dans la même
   transaction et pour la même inscription (C13)
5. ✅ Policies parent filtrées par `jwt_parent_id()` via `eleves.parent_id` (H2)
6. ✅ `echanger_acces_ecole` : verrou, tentatives par IP / identifiant / IP
   globale, bcrypt leurre (C11)
7. ✅ `echanger_jeton_parent` vérifie `parents.is_active` et `ecoles.is_active` (C9)
8. ✅ **Idempotence garantie en base** par `numeroter_recu` (lot d'une
   transaction précédente → `FJ412`) et rejeu dans `encaisser_paiement` (H6).
   **Ne pas** signaler l'absence d'index unique sur `lot_id` : il casserait les
   reçus de plusieurs lignes (faux positif de la relecture externe 2026-11-11).
9. ✅ **Cause d'erreur reconnue par son texte** (C14) : `inscrireEleve`
   (`calcul.erreur.startsWith("Rien à encaisser")`) et `modifierInscription`
   (`includes("date_depart")` sur une erreur 23514). Findings connus, **non
   bloquants**, déjà au backlog. **Ne pas** signaler `FJ412` comme fourre-tout :
   chaque `RAISE` a son message (faux positif de la relecture externe 2026-11-11).

Points 1 à 8 → corrects, à mentionner dans « ✅ Ce qui est bon ».
Point 9 → findings connus, à mentionner sans bloquer ni rouvrir.

S'il rate l'un de ces 9, renforcer la section correspondante.

---

## 📤 Format de sortie attendu

Le skill produit un rapport structuré avec :

- **Verdict** : `BLOQUANT` | `À CORRIGER` | `APPROUVÉ`
- **🔴 Critique** : un bloc par finding avec `fichier:ligne`, risque, code corrigé
- **🟠 Haute** : idem, plus condensé
- **🟡 Moyenne** : liste à puces
- **✅ Ce qui est bon** : liste obligatoire, pour ne pas décourager
- **Notes mineures (non listées comme findings)** : les `impact: cosmétique`
  en 1 ligne chacun, sans correction détaillée
- **Escalade** : si décision business/légale, question + 2 options + recommandation

Chaque finding critique doit inclure un **exemple de code corrigé prêt à
copier-coller**.