---
name: migration-schema
description: Faire évoluer la base Supabase de FayJàng (nouvelle colonne, table, contrainte, index, fonction, policy ou trigger) sans casser l'existant. À utiliser dès qu'un changement nécessite de modifier le schéma (supabase/schema/*.sql).
---

# Faire évoluer le schéma Supabase

Il n'y a pas d'outil de migration. Le schéma vit dans **5 fichiers sources** (`supabase/schema/*.sql`) ;
`supabase/schema.sql` est **généré** à partir d'eux par `bash supabase/scripts/build-schema.sh`, et c'est ce
fichier généré que l'utilisateur relance en entier dans l'éditeur SQL de Supabase. Il doit pouvoir tourner
plusieurs fois sans erreur (script **idempotent**).

**Ne jamais éditer `supabase/schema.sql` à la main** : il est écrasé au prochain build.

Le schéma ne bouge que dans une feature planifiée par `architect`, et après l'accord explicite de l'humain
(`.claude/WORKFLOW.md`, « Sur le schéma »). Toute écriture dans un fichier `.sql` déclenche une demande
d'accord (hooks `block-sql-writes.sh` et `block-sql-bash.sh`) : présenter le bloc à l'utilisateur avant de l'écrire.

## 1. Écrire le SQL dans le bon fichier source

| Fichier source | Ce qu'on y met |
|---|---|
| `01-tables.sql` | Une **nouvelle table** (`CREATE TABLE IF NOT EXISTS`) |
| `02-securite.sql` | RLS et policies d'une nouvelle table |
| `03-fonctions.sql` | Une nouvelle fonction |
| `04-triggers.sql` | Un nouveau trigger |
| `05-migrations.sql` | Tout changement d'un objet **existant** : colonne ajoutée, contrainte, index, et **remplacement** d'une fonction, d'une policy ou d'un trigger |

Ne jamais modifier ni supprimer un bloc existant : il a déjà été appliqué en production. Une évolution est
toujours un **nouveau bloc `vX.Y`**, ajouté **à la fin de `05-migrations.sql`**, sous le dernier bloc. Le numéro
suit le dernier bloc listé dans `.claude/SCHEMA-INDEX.md`.

```sql
-- ==============================================================================
-- vX.Y : <ce que ça apporte>
-- Bloc final : garder en dernier.
-- ==============================================================================
ALTER TABLE public.eleves
    ADD COLUMN IF NOT EXISTS lieu_naissance TEXT;
```

Ne jamais ajouter de données de démonstration (école, code, tokens) : le script tourne aussi en production.

Règles :
- `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`.
- Contraintes : les entourer d'un `DO $$ ... IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '...') ... $$;`.
- Colonne obligatoire : toujours avec un `DEFAULT`, sinon l'`ALTER` échoue sur les lignes existantes.
- Nouvelle table d'une école : `ecole_id UUID NOT NULL REFERENCES public.ecoles(id) ON DELETE CASCADE`, un index sur
  `ecole_id`, une ligne `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;` et ses politiques (au minimum
  `FOR ALL` pour `public.jwt_role_app() = 'ecole' AND ecole_id = public.jwt_ecole_id()`, avec `DROP POLICY IF EXISTS`
  avant chaque `CREATE POLICY`). Accès parent : politique `SELECT` filtrée par `public.jwt_parent_id()`.
- Nouvelle table d'une école que l'Espace École écrit : poser la garde d'abonnement (v1.20), sinon une école en
  lecture seule (abonnement expiré ou suspendu) pourra y écrire. Dans le bloc vX.Y de la table :
  ```sql
  DROP TRIGGER IF EXISTS trg_abonnement_ecriture ON public.x;
  CREATE TRIGGER trg_abonnement_ecriture BEFORE INSERT OR UPDATE OR DELETE ON public.x
      FOR EACH STATEMENT EXECUTE FUNCTION public.exiger_ecriture_ecole();
  ```
- Une table qui référence une autre table d'école : ajouter son cas au trigger `verifier_meme_ecole`.
- Nouvelle colonne de `paiements` : l'ajouter à la liste `IS DISTINCT FROM` de `proteger_paiement` dans le même bloc.
- Un secret (token, hash, code) ne va pas dans une table qui a une politique SELECT ouverte à un autre rôle
  (la RLS ne filtre pas les colonnes) : c'est pourquoi le code d'accès est dans `acces_ecole`, pas dans `ecoles`.
- Montants en FCFA : `INTEGER`. Dates métier : `DATE`. Mois de mensualité : `DATE` au 1er du mois.

### Migration de données (UPDATE / INSERT / DELETE sur des lignes existantes)

Jamais nue : le script étant relancé en entier, elle se rejouerait à chaque relance. L'envelopper avec
`schema_migrations`, sous un nom unique qui ne change plus jamais :

```sql
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.schema_migrations WHERE nom = 'vX.Y-description-courte') THEN
        UPDATE public.ma_table SET ... WHERE ...;
        INSERT INTO public.schema_migrations (nom) VALUES ('vX.Y-description-courte');
    END IF;
END $$;
```

Seule exception : un `UPDATE ... WHERE colonne IS NULL` qui remplit une nouvelle colonne et reste sans effet à la relance.

### Remplacer une fonction, une politique ou un trigger

Le script généré exécute les sources dans cet ordre : `01-tables`, `03-fonctions`, `02-securite`, `04-triggers`,
`05-migrations`. La dernière définition exécutée gagne : un remplacement s'écrit donc **dans le bloc final de
`05-migrations.sql`** (`CREATE OR REPLACE FUNCTION`, ou `DROP ... IF EXISTS` puis `CREATE`), jamais en modifiant
la définition d'origine dans 02, 03 ou 04. Garder la **même signature** pour une fonction appelée par `.rpc()`
(une surcharge donne l'erreur PostgREST PGRST203).

## 2. Régénérer le schéma et l'index

Dans cet ordre, depuis la racine du projet :

1. `bash supabase/scripts/build-schema.sh` (régénère `supabase/schema.sql`)
2. `bash scripts/schema-index.sh` (régénère `.claude/SCHEMA-INDEX.md`, que `database-reviewer` lit avant toute
   revue : un index périmé l'envoie sur les mauvaises lignes)

## 3. Mettre à jour les types

Dans `src/types/database.ts`, **dans le même commit** : ajouter la colonne dans le `type` de la table (Row),
ajuster les colonnes obligatoires de `Insert`, et le type de retour d'une fonction modifiée.

## 4. Lire et écrire la colonne

Ajouter la colonne aux `.select(...)` des pages (`src/app/ecole/page.tsx`, `src/app/parent/[token]/page.tsx`),
aux types de vue (`src/app/ecole/types.ts`) et aux actions concernées (`src/app/ecole/actions/*.ts`).

## 5. S'arrêter et prévenir l'utilisateur

L'humain relit le diff (`git diff supabase/schema/ supabase/schema.sql src/types/database.ts`) et applique en
base. Terminer en rappelant : « Relancez `supabase/schema.sql` dans l'éditeur SQL Supabase avant de déployer »,
sinon le code déployé lirait une colonne qui n'existe pas encore. Puis lancer `/verifier`.
