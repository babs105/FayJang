---
name: regles-dev-reprise
description: >
  Règles d'implémentation de la reprise de l'existant (import Excel) de FayJàng. Charger ce skill dès
  qu'on modifie src/app/ecole/import/** (page, reprise-panel.tsx, actions analyserFichierReprise /
  importerClassesReprise / importerLotReprise), src/lib/reprise-*.ts, le fixture reprise-cas.fixture.ts
  ou le modèle public/modele-import-ecole.xlsx. Contient le pipeline (lecture → colonnes → validation →
  répartition → lots → RPC), les invariants (fichier hostile, dû unique, rejeu sûr, reçu hors caisse),
  les tests chiffrés, les tests manuels et les anti-patterns.
---

# Règles de la reprise de l'existant — FayJàng

## Le pipeline

```
fichier (FormData, ≤ 2 Mo)
  → reprise-lecture.ts     controlerFichier / verifierContenu (avant exceljs) → lireClasseur
  → reprise-colonnes.ts    typeFeuille, reconnaitreEntetes, COLONNES_REQUISES
  → reprise-validation.ts  analyserReprise → ApercuReprise (erreurs par ligne, plafonnées)
  → reprise-classes.ts     classesACreer (importerClassesReprise)
  → reprise-repartition.ts repartirReprise : versé réparti dans les « bacs » de situationInscription()
  → reprise-lots.ts        decouper (TAILLE_LOT), construireLot, lireRetour, resumerRetour
  → rpc("importer_reprise") une transaction par lot ; doublons « ignore » en base
  → reprise-recu.ts        reçu « Reprise de l'existant », hors caisse (caisse.ts)
```

Chaque étape avant la RPC est une **fonction pure** : elle se teste sans base, avec
`reprise-cas.fixture.ts` (cas de la feuille « Cas d'exemple » du modèle).

## Invariants (non négociables)

### R1 — Le fichier est hostile
Contrôles d'archive **avant** qu'exceljs ne construise quoi que ce soit (`LIMITES` : 2 Mo, 10 Mo
décompressés mesurés en flux, 200 entrées, taux 100, 10 000 lignes XML, 20 feuilles, 2 100 lignes,
40 colonnes, 300 caractères). Toute nouvelle lecture passe par ces contrôles. Un texte qui commence
comme une formule est refusé (`ressembleAUneFormule`), pour ne pas la réinjecter dans l'export Excel.

### R2 — Une seule source du dû
`repartirReprise()` appelle `situationInscription()` **sans paiement** pour connaître les lignes
dues, les remplit avec le versé dans l'ordre d'encaissement de l'école, puis la rappelle sur les
paiements produits pour afficher l'arriéré et le reste de l'année. Les tests de parité
(`reprise-repartition.test.ts`) garantissent que l'aperçu = ce que l'app affichera après l'import.

### R3 — Écriture par lot, en une RPC
`importerLotReprise` envoie un lot (`TAILLE_LOT` élèves) à `importer_reprise`. Jamais d'`insert`
direct. Le matricule vient de `prochain_matricule` dans la fonction.

### R4 — Rejeu sûr
La base écarte les élèves déjà importés (statut « ignore »). Après l'envoi, une erreur ou une
réponse illisible renvoie `incertain: true` et demande de vérifier la liste avant de reprendre.
Les lectures de l'existant (doublons, classes) sont complètes (`toutLire`) ou refusées
(`LectureTropLongue`) : jamais tronquées.

### R5 — Reçu de reprise
`encaisse_par` = « Reprise de l'existant » (`ENCAISSE_PAR_REPRISE`), daté du jour de l'import,
sous-titre `SOUS_TITRE_REPRISE` sur le PDF, **exclu des totaux de caisse** (`caisse.ts`) et
reconnaissable sur la fiche et la page parent. Un utilisateur ne peut pas porter ce nom.

### R6 — Décisions tranchées à respecter (section 9 du feature spec)
- Service d'un élève parti sans aucun versement : dû pour le mois du départ, avec un avertissement.
- Période d'un service écrite dans « Articles optionnels » ; arrêt puis reprise possibles.
- `bodySizeLimit: "3mb"` : risque accepté, ne pas y toucher.

### R7 — Droits et abonnement
Directeur seulement (`peutFaire(role, "importer")` + refus en base) ; école en lecture seule refusée
dès l'analyse.

## Tests chiffrés obligatoires

Toute règle de lecture, de validation ou de répartition touchée a son test :
- un cas ajouté à `reprise-cas.fixture.ts` (entrée = ligne du fichier, sortie = paiements attendus,
  arriéré, reste sur l'année) si la règle se voit dans le modèle ;
- un test de parité `repartirReprise` / `situationInscription` si la répartition change ;
- un test de `reprise-lecture.test.ts` si une limite ou le modèle change (le modèle
  `public/modele-import-ecole.xlsx` doit être lu sans erreur).

## Tests manuels obligatoires

Avec l'école de test seulement (`docs/compte-test.local.md`), jamais une vraie école sans accord.
- **R-A Aperçu** : déposer le modèle rempli → aperçu sans erreur, totaux par classe cohérents.
- **R-B Fichier piégé** : fichier > 2 Mo, `.xlsx` renommé, cellule `=HYPERLINK(...)` → refus lisible.
- **R-C Classes** : classes manquantes créées avec leur catalogue ; relancer → rien en double.
- **R-D Import** : 30 élèves → 2 lots ; chaque élève a un reçu « Reprise de l'existant » ; le
  tableau de bord « Encaissé aujourd'hui » ne bouge pas.
- **R-E Rejeu** : relancer le même import → élèves « ignorés », aucun reçu ajouté.
- **R-F Chiffres** : pour un élève du fixture, arriéré et reste sur l'année de la fiche élève =
  ceux de l'aperçu.
- **R-G Caissier** : l'onglet Importer est refusé par le serveur.

## Anti-patterns

| Anti-pattern | Correction |
|---|---|
| `ExcelJS.load()` avant `controlerFichier` / `verifierContenu` | Contrôles d'abord (R1) |
| Limite relâchée « pour que le fichier passe » | Escalader : décision de l'humain |
| Mensualité ou arriéré recalculé dans `reprise-*.ts` | `situationInscription()` (R2) |
| Boucle d'`insert` élève par élève | `rpc("importer_reprise")` par lot (R3) |
| Lecture `.range(0, 999)` pour détecter les doublons | `toutLire` ou refus (R4) |
| Reçu de reprise compté dans la caisse du jour | `estRecuDeReprise` dans `caisse.ts` (R5) |
| Contenu d'une cellule ou nom d'élève dans un `console.log` | Rien de la famille dans les logs |
| `createAdminClient()` dans l'import | `sessionReprise()` + `createClientEcole` |

## Commandes de diagnostic rapide

```bash
grep -rn "createAdminClient\|service_role" src/app/ecole/import/ src/lib/reprise-*.ts
grep -n "\.insert(\|\.upsert(" src/app/ecole/import/actions.ts      # aucun résultat attendu
grep -n "console\." src/app/ecole/import/actions.ts src/lib/reprise-*.ts
npx vitest run src/lib/reprise-                                     # tests de la reprise seuls
```

## Reviews habituelles

- Action d'import modifiée (entrées, fichier) → `security-reviewer` sur l'action nommée.
- Appel ou fonction `importer_reprise` modifié → `database-reviewer` sur `importer_reprise`.
- Règle de répartition pure modifiée → `database-reviewer` sur `repartirReprise` (calcul d'argent).
- Libellé ou mise en page de l'aperçu → aucune.
