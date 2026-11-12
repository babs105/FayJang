# Codes d'erreur métier — FayJàng

> **Source de vérité.** Tout code `FJ4xx` levé par une fonction ou un trigger
> SQL doit être listé ici. Tout nouveau code doit être ajouté dans le même
> commit que la fonction qui le lève.
>
> Référencé par :
> - `regles-database-reviewer/SKILL.md` §C14
> - `CLAUDE.md` §Base de données
> - `src/lib/erreurs.ts` (`CODES_METIER`)

## Comment ça marche

1. Un trigger ou une fonction SQL fait `RAISE EXCEPTION '<message>' USING ERRCODE = 'FJxxx'`.
2. `messageErreur()` (`src/lib/erreurs.ts`) vérifie que `FJxxx` est dans `CODES_METIER`.
3. Si oui → le message Postgres est renvoyé au client (il est écrit en français).
4. Si non → message générique (`défaut`), et le code est loggé en console.

**Règle** : un code `FJxxx` est toujours écrit pour un directeur d'école ou un
parent, jamais pour un développeur. (« Motif obligatoire », pas « constraint violation ».)

## La liste

| Code | Fonction(s) qui le lève | Message utilisateur |
|---|---|---|
| `FJ403` | `proteger_colonnes_ecole` (trigger), `verifier_ecriture_ecole` (fonction appelée par les triggers `trg_abonnement_*`) | « Ces informations ne peuvent être modifiées que par FayJàng. » / « Abonnement expiré ou suspendu : l'Espace École est en lecture seule. Contactez FayJàng. » |
| `FJ404` | `verifier_meme_ecole` (trigger) | « Parent introuvable dans cette école. » / « Élève ou classe introuvable dans cette école. » / « Inscription introuvable dans cette école. » / « Classe introuvable dans cette école. » / « Inscription ou article introuvable dans cette école. » / « Article introuvable pour cet élève. » |
| `FJ412` | `proteger_paiement`, `proteger_inscription`, `numeroter_recu`, `proteger_article_inscription` (triggers) | « Ce paiement est déjà annulé. » / « Un paiement encaissé ne se modifie pas : annulez-le puis saisissez le bon. » / « Cette inscription a des paiements : passez-la en abandon au lieu de la supprimer. » / « Élève et année d'une inscription payée ne changent pas. » / « Ce reçu est déjà émis : impossible d'y ajouter une ligne. » / « Cet article a des paiements : arrêtez le service ou annulez les reçus. » / « Article déjà payé : son prix et sa quantité ne changent plus. » |
| `FJ422` | `proteger_paiement`, `numeroter_recu` (triggers) | « Indiquez le motif de l'annulation. » / « Un reçu ne concerne qu'un seul élève. » |
| `FJ429` | `controler_tentatives` (fonction) | « Trop de tentatives de connexion. Réessayez dans 15 minutes. » |

## Ce qui n'est PAS un code métier

- `23505` (UNIQUE) → géré par `messageErreur(..., doublon)` avec un message par contexte
- `23514` (CHECK) → tombe dans le message `défaut` (à améliorer si un cas précis se présente)
- `23503` (FK) → idem
- `42703` (colonne inconnue) → **jamais** laissé passer, c'est un bug

## Ajouter un nouveau code

1. Choisir un code `FJ4xx` libre (pas dans la liste ci-dessus).
2. L'ajouter dans le tableau **avant** d'écrire la fonction SQL.
3. L'ajouter dans `CODES_METIER` de `src/lib/erreurs.ts`.
4. Commenter le `RAISE EXCEPTION` d'une ligne au-dessus de la fonction SQL.
5. Tester en dev : le message apparaît, le code n'est pas fuité en production.