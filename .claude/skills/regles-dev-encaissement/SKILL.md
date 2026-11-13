---
name: regles-dev-encaissement
description: >
  Règles d'implémentation du flow d'encaissement de FayJàng. Charger ce skill dès
  qu'on modifie fiche-eleve.tsx, les actions encaisserPaiement / annulerPaiement,
  src/lib/scolarite.ts (soldes, arriérés, tranches du dernier mois), les reçus PDF
  ou la table paiements. Contient les invariants métier (recalcul serveur, reçu =
  lot, pas de suppression, tranches), le modèle de l'action, les tests manuels
  chiffrés obligatoires et les anti-patterns.
---

# Règles du flow d'encaissement — FayJàng

## Contexte du flow

L'administration de l'école encaisse depuis la **fiche élève** (Espace École) :
elle touche les mois à payer dans la grille, choisit le mode (espèces, Wave,
Orange Money, Free Money, virement, chèque) et valide. Le serveur recalcule ce
qui est dû, crée une ou plusieurs lignes dans `paiements` sous un même `lot_id`,
et la base leur attribue **un seul numéro de reçu**. Le reçu PDF liste les lignes
et le total. Le parent retrouve ses reçus sur `/p/[token]`.

**Fichiers du flow :**
- `src/app/ecole/fiche-eleve.tsx` : grille des mois, formulaire, bouton « Payer la
  tranche », case « Inclure la tranche … », historique, annulation.
- `src/app/ecole/actions.ts` : `encaisserPaiement(saisie)` et `annulerPaiement(id, motif)`.
- `src/lib/scolarite.ts` : `situationInscription()`, `mensualiteNette()`,
  `moisDesTranches()`, `maxTranches()`, `partEchue()`, `libelleTranche()`, `trancheAvecMois()`.
  **Partagé client / serveur** : la fiche affiche le même calcul que celui que le serveur applique.
- `src/lib/libelles.ts` : `libellePaiement()` (« Mensualité de janvier 2027 »,
  « Tranche 1/3 de juin 2027 »), `MODES_PAIEMENT`, `LIBELLE_MODE`.
- `src/lib/recu-donnees.ts` + `src/lib/recu-pdf.ts` : lecture du lot, PDF A5.
- `src/app/ecole/recu/[id]/route.ts`, `src/app/p/[token]/recu/[id]/route.ts`.
- `src/lib/dates.ts` : `todayDakar()`, `moisScolaires()`, `echeanceDuMois()`, `formatMois()`.

**Tables lues/écrites :**
- `ecoles` : calendrier (`annee_scolaire`, `mois_debut`, `nb_mensualites`,
  `jour_echeance`, `tranches_dernier_mois`, `mois_debut_tranches`, `nb_tranches`)
- `inscriptions` : tarifs figés (`frais_inscription`, `mensualite`, `reduction_mensuelle`), `statut`
- `paiements` : SELECT, INSERT (policy `ecole_encaisse`), annulation (policy
  `ecole_annule` + trigger `proteger_paiement`)

**Triggers à connaître :**
- `numeroter_recu` (BEFORE INSERT) : numéro `FJ-<année>-<00001>`, partagé par les
  lignes du même `lot_id` insérées dans la même transaction.
- `proteger_paiement` (BEFORE UPDATE) : seule l'annulation motivée passe.
- `trg_interdire_suppression_paiement` (BEFORE DELETE, bloc v1.19) : aucun paiement ne
  se supprime, même depuis l'éditeur SQL.
- `verifier_meme_ecole` : l'inscription doit appartenir à la même école.

## Invariants métier (non négociables)

### I1 — Le serveur recalcule, le client ne fait que choisir
L'action relit l'inscription et **tous** ses paiements, appelle
`situationInscription(ins, paiements, ecole, todayDakar())`, puis :
- inscription : montant ≤ reste des frais d'inscription ;
- mensualités : mois valides de l'année (`moisScolaires`), montant de chaque mois
  = son reste ; un montant partiel n'est accepté que pour **un seul** mois et
  ≤ son reste ;
- autre (tenue, transport…) : libellé obligatoire, montant > 0.
Un mois déjà soldé est ignoré ; si plus rien n'est dû : refus clair.

### I2 — Un encaissement = un lot = un reçu
Toutes les lignes d'un encaissement partagent un `lot_id` et sont créées **par la
fonction SQL `encaisser_paiement`** (un seul `INSERT`, une seule transaction) :
la base leur donne le même `numero_recu`. Ne jamais calculer ni écrire de numéro,
ne jamais faire d'`insert` direct sur `paiements` depuis l'action.

### I2 bis — Idempotence et concurrence
- Le `lot_id` est la **clé d'idempotence** : créée par le formulaire
  (`cleEncaissement` dans `fiche-eleve.tsx`, une par saisie, renouvelée après
  un succès ou quand la saisie change, voir `cleAEnvoyer`), validée par
  `lireCleEncaissement()` ; absente ou invalide, l'action en génère une.
- Même clé, même contenu → la base renvoie le reçu existant (`rejoue: true`,
  message « déjà enregistré », rien n'est ajouté). Même clé, contenu différent
  ou lot d'une autre transaction → `FJ412`.
- L'action envoie l'**empreinte** des paiements lus (`empreintePaiements` :
  nombre et total actif). Si un autre poste a encaissé entre la lecture et
  l'écriture, la base refuse (`FJ412`) au lieu d'encaisser deux fois.
- Ne jamais renouveler la clé à chaque clic : un double clic créerait deux reçus.

### I3 — Jamais de suppression ni de modification
Pas de `DELETE`, pas d'`UPDATE` de montant, de mois, de mode ou de référence. Une
erreur se corrige par `annulerPaiement(id, motif)` (3 caractères min.), qui annule
**toutes les lignes du lot**. Le reçu reste consultable, barré « ANNULÉ ».

### I4 — Tranches du dernier mois
Quand l'école active l'option, la mensualité du dernier mois est répartie en
`nb_tranches` parts dues avec les mensualités à partir de `mois_debut_tranches`
(au plus jusqu'à l'avant-dernier mois) :
- part exigible après k tranches : `k × floor(dû / n)`, la dernière solde le mois (`partEchue`) ;
- seules les tranches **échues** comptent dans l'arriéré (`resteEchu`) ;
- payer un mois qui porte une tranche ajoute la tranche manquante **au même reçu**
  (`trancheAvecMois`), sauf si le dernier mois est lui-même choisi ou si un montant
  partiel est saisi ; la case est cochée par défaut, `inclure_tranche: false` la retire ;
- les paiements d'avance sur le dernier mois sont déduits ;
- les lignes de tranche portent un libellé « Tranche k/n de <mois> » (`libelleTranche`).

### I5 — Mobile money tracé
Wave, Orange Money et Free Money exigent une **référence de transaction** (refus
sinon). Espèces, virement, chèque : référence facultative.

### I6 — Dates et montants
`paye_le = todayDakar()`. Montants entiers en FCFA, jamais de décimales, affichés
avec `formatFCFA()`.

**Élève parti (abandon, transfert)**, décision « Départ d'un élève » (section 9 de
`docs/feature-spec.md`) : avec une `date_depart`, les mois jusqu'au mois du départ
**inclus** restent dus (mois entamé = dû), ceux d'après ne le sont plus ; ce qui est
déjà payé est gardé. Restent dus : frais d'inscription, frais uniques, 1er mois payé à
l'inscription. Un ancien abandon **sans** date garde l'ancien calcul (seuls les mois
déjà payés), avec le bandeau « date de départ manquante ». Le paiement libre est refusé
pour un élève parti, par l'action et par `encaisser_paiement` (FJ412).

### I7 — Format de retour et erreurs
`{ success: boolean; message?: string; data?: { ids } }`, message en français
(« Reçu créé : 26 666 FCFA encaissés (dont tranche 1/3 de juin 2027 : 6 666 FCFA). »).
Erreurs via `messageErreur("paiements", err)`, jamais `error.message` brut.

## Modèle de l'action (code actuel, à conserver)

```ts
export async function encaisserPaiement(saisie: SaisiePaiement): Promise<Resultat<{ ids: string[] }>> {
  const s = await session();                                   // getEcoleId() + createClientEcole
  if (!s) return { success: false, message: SESSION_EXPIREE };
  // mode dans MODES_PAIEMENT, référence obligatoire pour le mobile money (I5), montant() si saisi

  if (!estUuid(saisie.inscription_id)) return { success: false, message: "Inscription introuvable." };

  // inscription + paiements + calendrier, toujours .eq("ecole_id", s.ecoleId), puis situationInscription()  (I1)
  const charge = await chargerSituation(s.supabase, s.ecoleId, saisie.inscription_id);
  const cle = lireCleEncaissement(saisie.cle) ?? randomUUID();          // I2 bis : clé du formulaire
  // lignes = lignesAEncaisser(situation, choix) : montants recalculés, tranche ajoutée au même reçu (I4)

  const empreinte = empreintePaiements(charge.paiements);              // I2 bis : rien n'a bougé depuis la lecture
  const { data, error } = await s.supabase.rpc("encaisser_paiement", { // I2 : un INSERT, une transaction
    p_inscription_id: ins.id, p_lot_id: cle, p_mode: reglement.mode, p_reference: reglement.reference,
    p_lignes: lignesPourRpc(lignes), p_nb_paiements: empreinte.nb, p_total_actif: empreinte.total,
  });
  if (error) throw error;                                              // → messageErreur("paiements", err)
  const resultat = lireResultatEncaissement(data);
  revalidatePath("/ecole");
  // resultat.rejoue → « Cet encaissement était déjà enregistré… », sinon « Reçu créé : … »
  return { success: true, message: "Reçu créé : …", data: { ids: resultat.ids } };
}
```

**Jamais** `createAdminClient()` dans ce flow.

## Tests manuels obligatoires (à chaque tranche)

Avec l'école de test (`docs/compte-test.local.md`), jamais les données d'une vraie
école sans l'accord de l'utilisateur. Exemple de référence : mensualité 20 000,
9 mensualités d'octobre à juin, échéance le 5, juin en 3 tranches à partir de janvier.

### E1 — Encaissement nominal
- [ ] Encaisser octobre en espèces → 1 reçu, mois « Payé », arriéré diminué de 20 000
- [ ] Le PDF affiche le bon élève, la bonne classe, le montant et le numéro

### E2 — Plusieurs mois, un reçu
- [ ] Encaisser décembre + janvier → **un seul** numéro de reçu sur toutes les lignes
- [ ] Avec tranches : la case « Inclure la tranche 1/3 de juin » est cochée, total = 40 000 + 6 666

### E3 — Paiement partiel
- [ ] Un seul mois avec 5 000 → statut « partiel », reste 15 000
- [ ] Montant partiel sur deux mois → refus ; montant > reste → refus

### E4 — Tranches
- [ ] « Payer la tranche » propose le retard s'il y en a, sinon la prochaine tranche
- [ ] Paiement d'avance sur juin → la tranche suivante tient compte du versé
- [ ] Juin sélectionné avec d'autres mois → juin payé entièrement, pas de tranche ajoutée en double
- [ ] Au 10 février sans rien payer sur juin : arriéré juin = 13 332 (2 tranches échues)

### E5 — Mobile money
- [ ] Wave sans référence → refus ; avec référence → référence sur le reçu

### E6 — Annulation
- [ ] Annuler un reçu de 3 lignes → les 3 lignes annulées, PDF barré « ANNULÉ »
- [ ] Les soldes reviennent à l'état d'avant ; le parent ne voit plus ces lignes
- [ ] Annuler sans motif → refus

### E7 — Isolation
- [ ] Le reçu d'une autre école (id copié) → 404 côté École
- [ ] Le reçu d'un autre parent via `/p/<mon-token>/recu/<id>` → 404

### E8 — Parent
- [ ] `/p/<token>` : grille, tranches « k/n », reçus téléchargeables, aucun reçu annulé

## Tests chiffrés de `scolarite.ts`

Tout changement de `scolarite.ts` a ses tests automatiques dans `src/lib/scolarite.test.ts`
(Vitest, `npm test`), qui couvrent au moins : tranche en retard, tranche payée, paiement
d'avance, tous les mois échus, arrondi (23 000 en 5 → 4 600 ×4 puis le solde), option
désactivée, élève en abandon, et l'exemple de référence de la v1.5 (132 000 à l'inscription,
26 666 en février). `npm test` doit passer ; lister les tests ajoutés dans le rapport.

## Anti-patterns (à rejeter en review)

| Anti-pattern | Correction |
|---|---|
| Montant à encaisser reçu du client et inséré tel quel | Recalcul avec `situationInscription()` (I1) |
| `insert` direct sur `paiements`, ou plusieurs appels pour un même encaissement | Un seul appel `rpc("encaisser_paiement")` (I2) |
| `numero_recu` calculé ou écrit dans le code | Laisser le trigger `numeroter_recu` |
| `DELETE` ou `update({ montant })` sur `paiements` | `annulerPaiement(id, motif)` (I3) |
| Annulation d'une seule ligne d'un reçu multi-lignes | Annuler tout le lot |
| Tranche calculée différemment côté fiche et côté serveur | Une seule fonction partagée dans `scolarite.ts` |
| Clé d'idempotence acceptée sans contrôle, ou renouvelée à chaque clic | `lireCleEncaissement()` côté serveur, une clé par saisie côté fiche (I2 bis) |
| Encaisser sans empreinte des paiements lus | `empreintePaiements()` passée à la fonction SQL (I2 bis) |
| `createAdminClient()` dans `src/app/ecole/` | `createClientEcole(ecoleId)` |
| `error.message` renvoyé au client | `messageErreur()` |
| `new Date()` pour `paye_le` ou une échéance | `todayDakar()` |

## Commandes de diagnostic rapide

```bash
# client admin introduit par erreur
grep -rn "createAdminClient\|service_role" src/app/ecole/ src/app/p/ src/lib/scolarite.ts

# suppression ou modification de paiement
grep -rn 'from("paiements")' src/ | grep -E "delete|update" | grep -v "annule: true"

# numéro de reçu écrit par le code
grep -rn "numero_recu" src/app/*/actions.ts   # aucun résultat attendu

# date métier calculée avec new Date()
grep -rn "new Date()" src/app/ecole/actions.ts src/lib/scolarite.ts
```

## Format de sortie attendu

Le rapport de l'agent contient :
- **Fichiers modifiés** (liste)
- **Code produit** (bloc ou diff)
- **Invariants vérifiés** (checklist I1-I7)
- **Reviews à déclencher** (`database-reviewer` sur X, `security-reviewer`
  sur Y, avec un scope nommé)
- **Tests manuels** (E1-E8 applicables à la tranche) et tests chiffrés si `scolarite.ts` change
- **Bugs du backlog résolus** et **bugs ajoutés au backlog** (bugs mineurs et dette `impact: maintien`  ; ni besoin
  ni piste, nulle part dans le rapport)
- **Hors scope identifié** (à re-planifier par `architect`)
