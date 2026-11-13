---
name: regles-dev-inscriptions
description: >
  Règles d'implémentation des élèves, inscriptions et classes de FayJàng. Charger ce skill dès qu'on
  modifie eleves-panel.tsx, classes-panel.tsx, la partie inscription de fiche-eleve.tsx, les actions
  inscrireEleve / modifierInscription / modifierEleve / supprimerEleve / enregistrerClasse /
  archiverClasse / ajouterArticleInscription / retirerArticleInscription / regenererLienParent,
  ou src/lib/metier/inscription-initiale.ts, matricule.ts, classe-catalogue.ts. Contient les invariants
  (tarifs figés, inscription atomique, parent par téléphone, on paie d'abord, départ), le modèle
  d'action, les tests manuels chiffrés et les anti-patterns.
---

# Règles des élèves, inscriptions et classes — FayJàng

## Contexte

L'école crée ses **classes** (niveau, frais d'inscription, mensualité, catalogue d'articles :
tenue, fournitures, transport, cantine…), puis **inscrit** chaque élève dans une classe pour
une année scolaire. L'inscription crée au besoin le **parent** (retrouvé par son téléphone) et
peut encaisser tout de suite les frais d'inscription et le 1er mois. Ensuite : modification de
l'identité, de la réduction mensuelle, des articles, départ (abandon, transfert), lien parent
régénéré. À venir : **changement de classe** (D01) et **réinscription en masse** (P02).

**Fichiers :**
- `src/components/ecole/eleves-panel.tsx` : liste, recherche, formulaire d'inscription
- `src/components/ecole/classes-panel.tsx` : classes, tarifs, catalogue, archivage
- `src/components/ecole/fiche-eleve.tsx` : partie identité / inscription / articles / départ / lien parent
- `src/app/ecole/actions/` (`inscriptions.ts`, `classes.ts`, `articles.ts`, `parents.ts`) : actions listées dans la description
- `src/lib/metier/inscription-initiale.ts` : `selectionnerArticles()`, `lignesPaiementInscription()`
- `src/lib/metier/classe-catalogue.ts` : `lireArticles()`, `MAX_ARTICLES_CLASSE`
- `src/lib/metier/matricule.ts`, `src/lib/validation/telephone.ts`, `src/lib/validation/saisie.ts`

**Fonctions SQL (version active dans `.claude/SCHEMA-INDEX.md`) :**
- `inscrire_eleve` : élève + parent + inscription + articles + paiement initial, une transaction
- `enregistrer_classe` : classe + catalogue, une transaction
- `prochain_matricule` : matricule FayJàng, avec verrou
- Triggers : `proteger_inscription` (tarifs figés), `proteger_article_inscription` (un service
  mensuel ne s'arrête pas avant son dernier mois payé), `verifier_meme_ecole` (un article d'élève
  vient du catalogue de SA classe), `trg_abonnement_ecriture` (lecture seule)

## Invariants (non négociables)

### N1 — Tarifs figés
`inscriptions.frais_inscription` et `mensualite` sont copiés de la classe à l'inscription. Modifier
le tarif d'une classe ne touche aucun élève inscrit. Un changement de classe (D01) écrit les
**nouveaux** tarifs sur l'inscription à partir du mois du changement ; les mois passés gardent
l'ancien tarif : c'est un calcul de solde, donc une tranche `dev-encaissement` pour `scolarite.ts`.

### N2 — Une écriture multi-tables = une fonction SQL
Inscription → `rpc("inscrire_eleve")` ; classe → `rpc("enregistrer_classe")`. Jamais plusieurs
`insert` successifs depuis l'action : une erreur au milieu laisserait un élève sans inscription
ou un parent orphelin. Toute nouvelle écriture de ce type est une nouvelle fonction SQL, proposée
en escalade (`/migration-schema`).

### N3 — Parent retrouvé par son téléphone
`normaliserTelephone()` côté serveur ; même téléphone dans l'école = même parent ; son nom et son
lien (`token`) ne changent pas ; un parent désactivé est réutilisé sans être réactivé.

### N4 — On paie d'abord
Changement de classe ou réinscription : refusés si l'élève n'a pas soldé son dû à date. Le serveur
relit l'inscription et ses paiements et appelle `situationInscription(ins, paiements, ecole, todayDakar())`
(lecture seule de `scolarite.ts`). Le client n'envoie jamais un « solde à jour ».

### N5 — Départ, pas suppression
Un élève parti garde son historique : `statut` abandon / transfert + `date_depart`. Mois dus jusqu'au
mois du départ inclus. `supprimerEleve` refuse dès qu'un paiement existe et oriente vers « Abandon ».

### N6 — Matricule par la base
`prochain_matricule` (appelée par `inscrire_eleve`). Jamais un matricule calculé dans l'action.

### N7 — Droits
Classes et catalogue : directeur seulement (`refusDroit(s, "classes")` + refus en base). Inscription,
modification d'un élève, articles : caissier autorisé (vérifier `src/lib/securite/droits.ts` avant d'affirmer).

## Modèle d'action

```ts
export async function changerClasse(saisie: { inscription_id: string; classe_id: string }): Promise<Resultat> {
  const s = await sessionEcriture();                     // session + lecture seule d'abonnement
  if (typeof s === "string") return { success: false, message: s };

  const inscriptionId = texte(saisie.inscription_id, 40);
  const classeId = texte(saisie.classe_id, 40);
  if (!estUuid(inscriptionId) || !estUuid(classeId)) return { success: false, message: "Élève ou classe introuvable." };

  try {
    // Lecture filtrée par ecole_id en plus de la RLS, puis règle « on paie d'abord » recalculée ici
    // … situationInscription(…) ; refus lisible si arriéré > 0
    const { error } = await s.supabase.rpc("changer_classe", { /* paramètres validés */ });
    if (error) throw error;
  } catch (err) {
    return { success: false, message: messageErreur("inscriptions", err) };
  }
  revalidatePath("/ecole");
  return { success: true, message: "Classe changée." };
}
```

## Tests manuels obligatoires

Avec l'école de test (`docs/compte-test.local.md`, élèves « Test ATOMIQUE »), jamais une vraie école
sans accord. Référence : classe CM1, inscription 25 000, mensualité 20 000, 9 mois d'octobre à juin.

- **N-A Inscription** : nouvel élève, parent nouveau, paiement inscription + octobre en espèces →
  1 reçu de 45 000, matricule attribué, lien parent fonctionnel.
- **N-B Parent existant** : 2e enfant avec le même téléphone écrit autrement (`77 123 45 67` /
  `+221771234567`) → même parent, même lien, nom du parent inchangé.
- **N-C Tarif figé** : passer la mensualité de CM1 à 22 000 → l'élève inscrit garde 20 000.
- **N-D Catalogue** : article obligatoire ajouté à la classe → proposé à la prochaine inscription,
  pas ajouté d'office aux élèves déjà inscrits (à vérifier dans la fiche de feature si elle dit autre chose).
- **N-E Départ** : départ le 12 janvier → janvier dû, février à juin plus dus ; payé conservé.
- **N-F Suppression** : élève avec un paiement → refus et message « Abandon ».
- **N-G Caissier** : un caissier ne voit pas / ne peut pas enregistrer une classe (refus serveur).
- **N-H Lecture seule** : école expirée → inscription refusée avec le message d'abonnement.
- **D01 (si concerné)** : élève à jour → changement accepté ; élève avec 20 000 d'arriéré → refus.

## Anti-patterns

| Anti-pattern | Correction |
|---|---|
| `insert` élève puis `insert` inscription depuis l'action | `rpc("inscrire_eleve")` (N2) |
| `update({ mensualite })` sur les inscriptions d'une classe quand son tarif change | Rien : tarifs figés (N1) |
| Parent cherché par nom, ou téléphone non normalisé | `normaliserTelephone()` (N3) |
| Solde « à jour » envoyé par le client pour autoriser un changement | `situationInscription()` côté serveur (N4) |
| `delete` d'un élève qui a payé | Statut + date de départ (N5) |
| Rôle testé en dur (`role === "directeur"`) | `peutFaire()` / `refusDroit()` (N7) |
| `createAdminClient()` dans `src/app/ecole/` | `sessionEcriture()` |
| `error.message` renvoyé au client | `messageErreur()` |

## Commandes de diagnostic rapide

```bash
grep -rn "createAdminClient\|service_role" src/app/ecole/
grep -n 'from("inscriptions")' src/app/ecole/actions/*.ts | grep -E "insert|update"
grep -n 'role === ' src/app/ecole/*.ts src/app/ecole/*.tsx
grep -n "new Date()" src/app/ecole/actions/*.ts src/lib/metier/inscription-initiale.ts
```

## Reviews habituelles (grille de `.claude/WORKFLOW.md`)

- Nouvelle action ou action modifiée avec entrées → `security-reviewer` sur l'action nommée.
- Action qui appelle `inscrire_eleve`, `enregistrer_classe` ou écrit `eleves` / `parents` /
  `inscriptions` → `database-reviewer` sur l'appel en plus.
- Nouvelle fonction SQL → les deux.
- UI seule (panel, libellé) → aucune.
