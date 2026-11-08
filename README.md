# FayJàng

Suivi de la scolarité des écoles privées au Sénégal : inscriptions, mensualités, paiements (espèces, Wave,
Orange Money, Free Money, virement, chèque), reçus PDF, relances WhatsApp et espace parent.

Même architecture que Cantine Pro : Next.js 15 + Supabase (RLS par JWT court ES256), hébergement Vercel.

## Espaces

| URL | Pour qui | Accès |
|---|---|---|
| `/` | Visiteurs | Page d'accueil |
| `/inscription` | Nouvelle école | Ouverture du compte (essai 30 jours) |
| `/ecole` | Direction / comptabilité | Identifiant (ou e-mail) + code |
| `/p/[token]` | Parents | Lien magique envoyé par WhatsApp |
| `/admin` | Équipe FayJàng | `SUPERADMIN_CODE` |

## Mise en route

1. Créer un projet Supabase, puis lancer **tout** `supabase/schema.sql` dans l'éditeur SQL.
2. Générer la clé de signature : `npx supabase gen signing-key --algorithm ES256`, l'importer dans
   Supabase > Project Settings > JWT Keys, et coller le JWK (une ligne) dans `SUPABASE_JWT_PRIVATE_KEY`.
3. `cp .env.local.example .env.local` et remplir les variables (`openssl rand -hex 32` pour les secrets).
4. `npm install` puis `npm run dev`, et ouvrir `/inscription` pour créer la première école.
5. Vérifier la configuration : `curl localhost:3000/api/diagnostic`.

## Parcours type

1. **Classes** : créer les classes de l'année avec frais d'inscription et mensualité.
2. **Élèves** → *Nouvelle inscription* : élève + parent (le téléphone regroupe la fratrie) + classe, frais encaissés.
3. **Fiche élève** : touchez les mois à encaisser, choisissez le mode (référence obligatoire pour le mobile money),
   un reçu `JP-2026-00001` est créé ; PDF téléchargeable, annulation motivée.
4. **Impayés** : arriérés triés, bouton WhatsApp avec message de relance et lien parent.
5. **Paiements** : journal du jour / mois / année, export Excel (paiements + soldes).
6. **Paramètres** : calendrier (1re mensualité, nombre, jour d'échéance) et passage à l'année suivante
   (les classes sont reprises, les élèves sont réinscrits depuis leur fiche).
