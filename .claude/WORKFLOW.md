# WORKFLOW — JàngPay

## Le cycle de livraison (non négociable)

**1 tranche = 1 branche de slice = 1 agent dev = 1 rapport = N reviews
= 1 merge vers la branche de feature.**

**1 feature = N tranches = 1 merge vers `main` (donc 1 déploiement prod).**



## Règles

### Sur le plan
- L'architect **ne déclenche rien**. Il écrit un plan. C'est l'humain qui
  déclenche chaque étape.
- Chaque tranche est **verticale** : un peu de schéma, un peu de serveur,
  un peu d'UI, pour livrer un flow utilisateur complet. Pas de "T1 schéma",
  "T2 serveur", "T3 UI".
- Chaque review a un **scope nommé** : "sur la table `paiements`", "sur
  l'action `submitVoteAction`". Jamais "sur le schéma" ou "sur le front".

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
- Le dev reçoit **une seule tranche** à la fois. Le texte exact copié depuis
  le plan.
- Le dev **ne touche jamais** `supabase/schema.sql` (il propose l'`ALTER`,
  l'humain l'applique via `/migration-schema`).
- Le dev **ne touche jamais** `src/types/database.ts` à la main (il signale
  qu'il faut le mettre à jour, l'humain le fait).
- Le dev **ne déclenche pas** les reviews lui-même. Il les liste dans son
  rapport. C'est l'humain qui les invoque.

### Sur les reviews
- `database-reviewer` est **obligatoire** si la tranche touche :
  `schema.sql`, une policy RLS, une fonction `SECURITY DEFINER`, une vue,
  un trigger, ou une Server Action qui appelle `.rpc()` / `.from()` sur
  une table sensible.
- `security-reviewer` est **obligatoire** si la tranche touche :
  `jeton.ts`, `server.ts`, une session (`ecole-session.ts`,
  `admin-session.ts`), `admin.ts`, une route `api/**`,
  une page de login ou d'inscription, ou un nouveau flow d'auth. Il n'y a
  pas de `middleware.ts` : chaque fichier vérifie sa propre session.
- Un verdict `BLOQUANT` renvoie au dev sur la même tranche. On ne passe
  pas à T(n+1).

### Sur le merge
- **Merge tranche → branche de feature** : dès que la tranche est
  approuvée (reviews + tests sur la preview de la branche de slice).
  Automatique, sans cérémonie.
- **Merge branche de feature → `main`** : **manuel**, une seule fois,
  après validation humaine de l'ensemble de la feature sur la preview
  Vercel de `feat/<feature>`. C'est ce merge qui déclenche le déploiement
  en production.
- Jamais de merge sans les reviews du scope nommé.
- Jamais de merge sans `npx tsc --noEmit` (le hook le fait, mais vérifier).
- Jamais de `git push` sur `main` par un agent.
- Pas de tests automatisés dans le projet (règle du `CLAUDE.md`) : les
  tests sont manuels, listés dans le rapport du dev.

## Agents permanents vs agents jetables

### Permanents (compétence transversale)
| Agent | Rôle |
|---|---|
| `architect` | Planifie, découpe en tranches, nomme les scopes de review |
| `database-reviewer` | Audite la couche SQL (RLS, SECURITY DEFINER, migrations) |
| `security-reviewer` | Audite la couche Next.js (cookies, JWT, contrôle de session par route, Server Actions) |

Ces trois agents **ne changent pas** au fil des features. Ils sont stables.

### Jetables (une feature, puis archivés)
| Agent | Feature |
|---|---|
| `dev-paiements` | Encaissements, reçus, annulations (à créer) |
| `dev-relances` | Relances WhatsApp / SMS des impayés (à créer) |
| `dev-espace-parent` | Page `/p/[token]` (à créer) |
| etc. | |

Un agent dev est créé pour une feature, utilisé le temps des tranches, puis
archivé quand la feature est stable. Le prochain agent dev le remplace.

**Ne pas créer 10 agents dev d'un coup.** Un seul à la fois, tester le
cycle complet (plan → dev → reviews → merge), puis passer au suivant.

## Alignement avec `CLAUDE.md`

Le `WORKFLOW.md` ne remplace pas `CLAUDE.md`. Il le complète :

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
   Les dépendances entre tranches (T(n+1) lit souvent ce que Tn a écrit)
   deviennent floues.
3. **Merger sans les reviews.** Surtout sur `paiements`, `inscriptions`,
   `parents`. Une policy `USING(true)` non vue = fuite en prod.
4. **Review générique.** "database-reviewer, regarde le schéma" → il va
   tout relire, rater des choses, et tu vas payer 10× le contexte.
   Toujours un scope nommé.
5. **Laisser le dev déclencher les reviews.** Si le dev appelle
   `database-reviewer` lui-même, tu ne vois pas le rapport intermédiaire,
   tu ne peux pas arbitrer, et tu perds la main.
6. **Merger chaque tranche vers `main`.** Si une feature a 3 tranches et
   que chacune va en prod, la prod change 3 fois pour 1 feature. Pire : si
   T1 est un bouton et T2 l'action derrière, T1 en prod = bouton qui ne
   fait rien. **Une feature = un seul merge vers `main`.**

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

- [ ] `npx tsc --noEmit` passe (le hook le fait en fin de tour)
- [ ] `database-reviewer` a rendu APPROUVÉ sur son scope nommé (si applicable)
- [ ] `security-reviewer` a rendu APPROUVÉ sur son scope nommé (si applicable)
- [ ] Tests manuels listés dans le rapport du dev : tous passent
- [ ] Preview Vercel de `feat/<feature>-tN` vérifiée si l'UI change
- [ ] Aucune donnée réelle modifiée sans accord de l'utilisateur
- [ ] Commit au format `type: description en français`
- [ ] Merge `feat/<feature>-tN` → `feat/<feature>`
- [ ] Branche de slice supprimée (`git branch -d feat/<feature>-tN`)

## Checklist avant de merger une feature (vers `main`)

- [ ] Toutes les tranches de la feature sont mergées dans `feat/<feature>`
- [ ] Tests de bout en bout de la feature sur la preview de `feat/<feature>`
- [ ] 4 flows critiques vérifiés : login École, inscription élève, encaissement + reçu, page parent
- [ ] `npx tsc --noEmit` passe sur la branche de feature
- [ ] Aucune donnée réelle modifiée sans accord de l'utilisateur
- [ ] Accord explicite pour le merge vers `main` (c'est un déploiement prod)
- [ ] Merge `feat/<feature>` → `main`
- [ ] `git push` sur `main`
- [ ] Branche de feature supprimée

## Exemple complet — feature « changer d'avis » (3 tranches)

```bash
# Démarrage de la feature
git checkout main && git pull
git checkout -b feat/relances-sms

# --- Tranche 1 ---
git checkout -b feat/relances-sms-t1
@agent-dev-paiements implémente T1
# ... code, rapport, reviews, tests sur preview feat/relances-sms-t1 ...
git add <fichiers-du-scope>
git commit -m "feat: relancer les parents par SMS"
git push -u origin feat/relances-sms-t1
# reviews APPROUVÉ + tests OK
git checkout feat/relances-sms
git merge feat/relances-sms-t1
git push
git branch -d feat/relances-sms-t1

# --- Tranche 2 ---
git checkout -b feat/relances-sms-t2
@agent-dev-paiements implémente T2
# ... idem ...
git checkout feat/relances-sms
git merge feat/relances-sms-t2
git branch -d feat/relances-sms-t2

# --- Tranche 3 ---
git checkout -b feat/relances-sms-t3
@agent-dev-paiements implémente T3
# ... idem ...
git checkout feat/relances-sms
git merge feat/relances-sms-t3
git branch -d feat/relances-sms-t3

# --- Fin de feature : UN SEUL merge vers main ---
# Tests de bout en bout sur la preview de feat/relances-sms
# 4 flows critiques vérifiés
# Accord explicite pour le merge prod
git checkout main && git pull
git merge feat/relances-sms
git push
git branch -d feat/relances-sms
# → 1 déploiement Vercel en prod, pour 3 tranches