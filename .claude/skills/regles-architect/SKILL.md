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
| `supabase/schema.sql` | `database-reviewer` sur les objets modifiés UNIQUEMENT |
| `src/types/database.ts` | Mis à jour à la main par l'humain avec chaque migration (pas de génération CLI) |
| `src/lib/supabase/server.ts` | `database-reviewer` (appels `echanger_*`) + `security-reviewer` |
| `src/lib/supabase/admin.ts` | `security-reviewer` |
| `src/lib/supabase/jeton.ts` | `security-reviewer` |
| `src/lib/ecole-session.ts`, `admin-session.ts` | `security-reviewer` |
| Pages et actions de login / inscription (`/ecole/login`, `/admin/login`, `/inscription`) | `security-reviewer` |
| `src/app/**/route.ts` (reçus PDF, export Excel, diagnostic) | `security-reviewer` |
| `src/lib/scolarite.ts` (soldes, arriérés, tranches) | `database-reviewer` sur la fonction modifiée + tests chiffrés à la main |
| `src/lib/recu-pdf.ts`, `recu-donnees.ts` | Vérification visuelle d'un reçu par l'humain (pas de tests automatisés) |

## Matrice scope → reviewer (le cœur du feature-specific)

Quand une tranche touche à... | Reviewer | Scope à donner EXPLICITEMENT
---|---|---
Une table / colonne / contrainte | `database-reviewer` | "sur la table `<nom>` et ses policies"
Une policy RLS | `database-reviewer` | "sur la policy `<nom>`"
Une fonction SECURITY DEFINER | `database-reviewer` | "sur la fonction `<nom>`"
Un trigger (`numeroter_recu`, `proteger_paiement`, `verifier_meme_ecole`…) | `database-reviewer` | "sur le trigger `<nom>` de la table `<table>`"
Un calcul d'argent (`situationInscription`, tranches) | `database-reviewer` | "sur la fonction `<nom>` de `scolarite.ts` et son appel dans `<action>`"
Une Server Action qui appelle `.rpc()` | `database-reviewer` | "sur l'appel RPC `<nom>` de l'action `<nom>`"
Une Server Action qui valide des inputs | `security-reviewer` | "sur l'action `<nom>`"
Un cookie / une session | `security-reviewer` | "sur le cookie `<nom>` dans `<fichier>`"
La protection d'une route (pas de middleware : contrôle de session dans chaque fichier) | `security-reviewer` | "sur le contrôle de session de `<fichier>`"
Une route de téléchargement (reçu, export) | `security-reviewer` | "sur la route `<path>`"
Un composant qui affiche des données d'une école ou d'une famille | `security-reviewer` | "sur le composant `<nom>`"
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
**Fichiers** : `supabase/schema.sql`, `src/app/ecole/actions.ts`, `src/app/ecole/fiche-eleve.tsx`
**Scope des reviews** :
- `database-reviewer` : sur le trigger `numeroter_recu` (version v1.5) UNIQUEMENT
- `security-reviewer` : sur `encaisserPaiementFamille` UNIQUEMENT
**Porte de sortie** : 2 lignes de paiement, même `numero_recu`, `lot_id` identique,
`inscription_id` différentes, même `parent_id` → refus si on mélange deux parents
**Tests manuels** :
- [ ] Awa + Moussa (même parent) → 1 reçu de 40 000
- [ ] Awa + un élève d'un autre parent → refus clair
- [ ] Double-clic → un seul reçu

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

## Checklist finale avant de rendre un plan

- [ ] Scope strict écrit (dans / hors feature)
- [ ] Critère "done" global en 1 phrase vérifiable
- [ ] Tranches **verticales**, pas par couche
- [ ] Chaque tranche a un critère de sortie **end-to-end**
- [ ] Chaque review a un **scope explicite nommé**
- [ ] Dépendances et parallélisations signalées
- [ ] "Hors feature" explicite
- [ ] Aucune tranche "schéma seule" ou "UI seule"
- [ ] Findings de `BACKLOG.md` croisés par la feature intégrés

## Le cycle de livraison (non négociable)

1 tranche = 1 agent dev = 1 rapport = N reviews = 1 merge. Puis on recommence.
