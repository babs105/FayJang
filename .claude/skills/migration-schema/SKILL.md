---
name: migration-schema
description: Faire évoluer la base Supabase de JàngPay (nouvelle colonne, table, contrainte ou index) sans casser l'existant. À utiliser dès qu'un changement nécessite de modifier supabase/schema.sql.
---

# Faire évoluer le schéma Supabase

Il n'y a pas d'outil de migration : `supabase/schema.sql` est un script **idempotent** que l'utilisateur
relance en entier dans l'éditeur SQL de Supabase. Il doit pouvoir tourner plusieurs fois sans erreur.

Toute écriture dans un fichier `.sql` déclenche une demande d'accord (hook `block-sql-writes.sh`) :
présenter le bloc à l'utilisateur avant de l'écrire.

## 1. Ajouter le SQL après le dernier bloc de migration

Ne jamais modifier ni supprimer les blocs existants : ils ont déjà été appliqués en production.
Ajouter un bloc commenté à l'emplacement marqué « Nouveaux blocs de migration », juste avant la section 8
(`ENABLE ROW LEVEL SECURITY`). Ne jamais ajouter de données de démonstration (école, code, tokens) :
le script tourne aussi en production.

```sql
-- vX.Y : <ce que ça apporte>
ALTER TABLE public.eleves
    ADD COLUMN IF NOT EXISTS lieu_naissance TEXT;
```

Règles :
- `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`.
- Contraintes : les entourer d'un `DO $$ ... IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '...') ... $$;`.
- Colonne obligatoire : toujours avec un `DEFAULT`, sinon l'`ALTER` échoue sur les lignes existantes.
- Nouvelle table d'une école : `ecole_id UUID NOT NULL REFERENCES public.ecoles(id) ON DELETE CASCADE`, un index sur
  `ecole_id`, une ligne `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;` et ses politiques en section 9 (au minimum
  `FOR ALL` pour `public.jwt_role_app() = 'ecole' AND ecole_id = public.jwt_ecole_id()`, avec `DROP POLICY IF EXISTS`
  avant chaque `CREATE POLICY`). Accès parent : politique `SELECT` filtrée par `public.jwt_parent_id()`.
- Une table qui référence une autre table d'école : ajouter son cas au trigger `verifier_meme_ecole`.
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

Un `CREATE OR REPLACE FUNCTION` placé avant la section 9 serait écrasé à chaque relance par la définition de la
section 9 ou 10. Les remplacements vont dans un **bloc final** en fin de fichier, qui doit toujours rester le dernier.

## 2. Mettre à jour les types

Dans `src/types/database.ts`, ajouter la colonne dans le `type` de la table (Row) ; ajuster les colonnes
obligatoires de `Insert` si besoin.

## 3. Lire et écrire la colonne

Ajouter la colonne aux `.select(...)` des pages (`src/app/ecole/page.tsx`, `src/app/p/[token]/page.tsx`),
aux types de vue (`src/app/ecole/types.ts`) et aux actions concernées (`src/app/ecole/actions.ts`).

## 4. Prévenir l'utilisateur

Terminer en rappelant : « Relancez `supabase/schema.sql` dans l'éditeur SQL Supabase avant de déployer »,
sinon le code déployé lirait une colonne qui n'existe pas encore. Puis lancer `/verifier`.
