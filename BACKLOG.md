# Backlog — FayJàng

> Les findings d'audit qui ne sont pas corrigés dans la PR courante arrivent ici.
> Un finding dans ce fichier **n'est pas une urgence**. Il attend qu'une feature
> le croise.
>
> Règles :
> - Ne rien corriger depuis ce fichier sans passer par `architect`.
> - Ne rien supprimer sans avoir la preuve que c'est fait (commit, PR, numéro de ligne).
> - Une décision tranchée ne se rouvre pas sans raison nouvelle.
> - Le dev (`dev-encaissement` ou la session principale) gère ce fichier avec l'autorisation de l'humain :
>   il **ajoute** sans demander les findings non corrigés de sa tranche ; il **coche, supprime, modifie**
>   une entrée ou écrit dans « Décisions tranchées » seulement après l'accord explicite de l'humain.
> - Classement (détail dans `.claude/WORKFLOW.md`, section « Le backlog ») :
>   - **Chantier** dès qu'un de ces points est vrai : plus d'1 h de travail, touche `schema.sql`,
>     l'auth ou l'argent (encaissement, reçus, soldes), plus de 2 fichiers, ou décision métier à prendre ;
>   - **Correction mineure** sinon : correctif court et localisé.
>   - Une nouvelle entrée s'ajoute à la fin de sa section, avec son origine (review, tranche, date).

---

## Chantiers (feature-scale, à planifier avec architect)

- [x] **Encaissement d'un mois hors période du service** (H4) — `encaisser_paiement` (bloc v1.8) accepte, pour un
  article mensuel, n'importe quel mois de l'année sans le comparer à `mois_debut` ni à `mois_fin` : un service arrêté
  en novembre peut encore être encaissé pour mars, ce qui repousse ensuite le dernier mois payé au-delà de l'arrêt.
  Décision métier à prendre (refus en base FJ412, ou simple avertissement à l'école ; recommandation du reviewer :
  refus). Correctif : après la lecture de `v_art`, refuser si `v_mois < mois_debut` ou `v_mois > mois_fin`, dans un
  nouveau bloc en fin de `05-migrations.sql`. *Estimé : 1 h. Croise : services mensuels, arrêt de service.*
  (review database tranche 1 « intégrité des données », 2026-11-10)
  **Résolu** : refus FJ412 en base, bloc v1.16 de `encaisser_paiement` (tranche 3 « reprise de l'existant », 2026-11-11, schéma appliqué).

---

## Corrections mineures (à appliquer quand une feature croise le sujet)

- [ ] **Suppression accidentelle d'un paiement en éditeur SQL** — aucune policy
  `FOR DELETE`, aucun trigger `BEFORE DELETE` sur `paiements`. La RLS protège
  l'application (JWT), mais l'éditeur SQL (rôle postgres) bypass la RLS. Un
  humain peut supprimer un vrai reçu par accident. Correctif : trigger
  `BEFORE DELETE` + flag `SET LOCAL fayjang.allow_paiement_delete = 'on'` pour
  le nettoyage de tests. *Estimé : 1 h. Croise : mise en production avec de
  vrais reçus.*

- [ ] **Headers de sécurité absents** (S9) — aucun `X-Frame-Options`,
  `X-Content-Type-Options`, `Referrer-Policy`, CSP dans `next.config.ts`. Le
  `Referrer-Policy` compte : l'URL de la page parent contient le token. Correctif :
  `headers()` dans `next.config.ts`. *Estimé : 1 h. Croise : prochaine tranche sur /p/[token].*


- [ ] **Dates saisies : 31 février accepté** — `isDateValide` (`src/lib/dates.ts`) accepte une date
  inexistante (ex. 2026-02-31) ; corrigé pour la date de départ (contrôle par aller-retour dans
  `modifierInscription`), mais pas pour la date de naissance (`inscrireEleve`, `modifierEleve`).
  Correctif : renforcer `isDateValide` par l'aller-retour ISO. *Estimé : 15 min. Croise : prochaine
  tranche sur la fiche élève.* (review tranche 2 « départ d'un élève », 2026-11-08)

- [ ] **Erreur 23514 de `modifierInscription` reconnue par sous-chaîne** — la contrainte de la date
  de départ est repérée par « date_depart » dans le message ; toute autre contrainte CHECK future
  afficherait le message de la réduction. Correctif : tester les noms complets des contraintes.
  *Estimé : 10 min. Croise : prochaine modification de `modifierInscription`.* (review tranche 2, 2026-11-08)

- [x] **Formules Excel non neutralisées dans l'export** — les noms d'élève et de parent saisis
  librement peuvent commencer par `=`, `+`, `-` ou `@` et être interprétés comme formules à
  l'ouverture (`src/app/ecole/export/route.ts`). Correctif : préfixer d'une apostrophe ces chaînes
  avant `addRow`. *Estimé : 20 min. Croise : toute évolution de l'export.* (review tranche 3 « départ d'un élève », 2026-11-08)
  **Résolu** : `celluleTexte` (`src/lib/export-sur.ts`) préfixe d'une apostrophe tout texte libre commençant par =, +, -, @,
  tabulation ou retour chariot (téléphones +221 laissés tels quels) ; devenu prioritaire avec l'import en masse
  (tranche 7, 2026-11-11).

- [ ] **`classe_id` et date de naissance non contrôlés à l'inscription** (S7) — `inscrireEleve` ne vérifie
  pas que `classe_id` est un UUID, ni qu'une date de naissance n'est pas dans le futur : le message reste
  générique (« Opération impossible… ») ou la date future est acceptée. `eleve_id` est contrôlé depuis la
  tranche 2. Le 31 février relève de l'entrée « Dates saisies » ci-dessus. Correctif : regex UUID avec
  « Choisissez une classe. » et `date_naissance <= todayDakar()`. *Estimé : 15 min. Croise : prochaine
  tranche sur la fiche élève.*
  (review security tranche 1 « inscription atomique », 2026-11-10)

- [ ] **Message ambigu pour une classe désactivée** — `inscrire_eleve` (bloc v1.7 de
  `supabase/schema/05-migrations.sql`) répond « Choisissez une classe. » pour une classe désactivée comme
  pour une classe inexistante. Correctif : « Classe introuvable ou désactivée. », sans distinguer une classe
  d'une autre école. *Estimé : 5 min. Croise : tranche 2 « inscription atomique ».*
  (review database tranche 1 « inscription atomique », 2026-11-10)

- [ ] **Parent connu réécrit à chaque inscription** — `ON CONFLICT … DO UPDATE SET nom = p.nom` dans
  `inscrire_eleve` crée une nouvelle version de la ligne `parents` (un peu de bloat, verrou de ligne).
  Correct fonctionnellement. Correctif si besoin : `ON CONFLICT DO NOTHING RETURNING id` puis `SELECT`.
  *Estimé : 15 min. Croise : import Excel des élèves (inscriptions en masse).*
  (review database tranche 1 « inscription atomique », 2026-11-10)
  **Mise à jour** : corrigé dans `importer_reprise` (ON CONFLICT DO NOTHING, tranche 5) ; reste à faire dans `inscrire_eleve`
  (voir aussi « Ordre des verrous inscription / import »).

- [ ] **Message FJ422 unique pour l'encaissement à l'inscription** — une ligne mal formée, un montant au-delà du
  dû ou un libellé trop long donnent tous « Montant à encaisser incohérent avec le tarif, réessayez. » dans
  `inscrire_eleve`. Correctif : messages distincts selon la cause. *Estimé : 20 min. Croise : prochaine évolution
  de `inscrire_eleve`.* (review database tranche 2 « inscription atomique », 2026-11-10 ; la partie « libellé du
  catalogue sans plafond » est réglée par le CHECK `articles_classe_libelle_longueur`, bloc v1.9, commit `29d748e`)

- [ ] **Confirmation de changement d'année trompeuse** — `parametres-panel.tsx` demande « Les classes seront
  reprises » même quand la nouvelle année a déjà ses classes (aucune copie, l'école le découvre après coup par le
  message « existent déjà »). Correctif : adapter le texte du `confirm()` (ou dire « si la nouvelle année n'a pas
  encore de classes »). *Estimé : 10 min. Croise : prochaine retouche de l'onglet Paramètres.*
  (test preview « opérations atomiques », 2026-11-10)

- [ ] **Version unique des fonctions v1.9 à v1.11 à vérifier en base** — après application du schéma :
  `SELECT oid::regprocedure FROM pg_proc WHERE proname IN ('enregistrer_classe', 'enregistrer_parametres',
  'inscrire_eleve');` doit renvoyer trois lignes (PGRST203 sinon). Vérifié en base locale, pas encore sur Supabase.
  *Estimé : 2 min. Croise : mise en production de « opérations atomiques ».* (2026-11-10)

- [ ] **« Rien à encaisser » reconnu par son texte** (S7) — `inscrireEleve` repère ce cas avec
  `calcul.erreur.startsWith("Rien à encaisser")` ; si le libellé de `lignesAEncaisser` change, une inscription sans
  rien à payer serait refusée à tort (rien créé). Correctif : indicateur explicite renvoyé par
  `lignesPaiementInscription`. *Estimé : 15 min. Croise : prochaine évolution de `lignesAEncaisser`.*
  (review security tranche 2 « inscription atomique », 2026-11-10)

- [ ] **`inscription_id` non validé en UUID dans `encaisserPaiement`** (S7) — un identifiant malformé part en
  base et revient en erreur 22P02, interceptée par `messageErreur` (message générique, aucune fuite). Correctif :
  valider le format UUID avant la requête. *Estimé : 10 min. Croise : durcissement des Server Actions.*
  (review security tranche 1 « encaissement atomique », 2026-11-10)

- [ ] **Verrou de lot absent de `inscrire_eleve`** (M4) — `encaisser_paiement` prend `pg_advisory_xact_lock` sur
  `(école, lot_id)`, pas `inscrire_eleve` : un même `lot_id` partagé entre les deux fonctions en parallèle n'est pas
  couvert (deux UUID identiques, improbable). Correctif : prendre le même verrou dans `inscrire_eleve`.
  *Estimé : 10 min. Croise : prochaine migration touchant `inscrire_eleve`.*
  (review database tranche 1 « encaissement atomique », 2026-11-10)

- [x] **Espace École limité à 1000 lignes par table** — `src/app/ecole/page.tsx` (et `/ecole/export`) lisent élèves,
  parents, inscriptions et paiements en une seule requête : PostgREST en renvoie 1000 au plus, la suite est ignorée
  sans erreur. Une école de plus de 1000 élèves (ou paiements) verrait des listes et des soldes incomplets. Correctif :
  lecture paginée (`range`), comme `toutLire` de `src/app/ecole/import/actions.ts`. *Estimé : 1 h. Croise : import
  Excel (écoles de plus de 500 élèves).* (tranche 1 « reprise de l'existant », 2026-11-11)
  **Résolu** : lectures paginées et `.in()` par paquets de 150 (`src/lib/lecture-paginee.ts`) dans `src/app/ecole/page.tsx` et `/ecole/export` (tranche 7, 2026-11-11). Pagination par curseur sur l'id (une écriture pendant la lecture ne duplique ni ne saute de ligne), plafond
  de 50 000 lignes ; l'import utilise le même helper.

- [ ] **Commentaires de cellule écrits par openpyxl illisibles par exceljs** — un classeur produit par un outil qui
  écrit ses commentaires comme openpyxl fait échouer `lireClasseur` (« Fichier Excel illisible »). Le modèle n'a plus de
  commentaires ; un fichier enregistré depuis Excel ou LibreOffice n'est pas concerné. Correctif si une école bute
  dessus : retirer les commentaires avant le chargement, ou message dédié. *Estimé : 1 h. Croise : V2 de l'import
  (fichiers d'école tels quels).* (tranche 1 « reprise de l'existant », 2026-11-11)

- [ ] **Limite de fréquence sur l'analyse du fichier d'import** (S10) — chaque appel à `analyserFichierReprise`
  déclenche un parsing exceljs et environ 7 lectures paginées ; une école connectée peut les enchaîner. Correctif :
  limite par école (ex. 10 analyses par 10 min), réutilisable pour l'import réel. *Estimé : 1 h. Croise : tranche 5
  de l'import.* (review security tranche 1 « reprise de l'existant », 2026-11-11)

- [x] **`toutLire` tronque en silence au-delà de ~22 000 lignes** (S7) — acceptable pour l'aperçu, pas pour l'écriture :
  une liste incomplète fausserait la détection des doublons. Correctif : lever une erreur au-delà du plafond et
  s'appuyer sur une contrainte d'unicité en base. *Estimé : 30 min. Croise : tranche 5 de l'import.*
  (review security tranche 1 « reprise de l'existant », 2026-11-11 ; relevé aussi par les deux reviews de la tranche 2)
  **Résolu** : lève une erreur au-delà du plafond ; doublons écartés en base par `importer_reprise` (tranche 5, 2026-11-11).

- [x] **Service mensuel d'un élève parti sans aucun versement** (M-A) — tranché par l'humain : c'est un dû.
  `repartirReprise` rattache le service, obligatoire ou optionnel, pour le mois du départ, avec l'avertissement
  « aucun versement, il est dû pour le mois du départ » (l'ancien message « demandé après le départ » disparaît).
  (review database tranche 2 « reprise de l'existant », 2026-11-11)

- [x] **Article unique de quantité 0 rattaché à l'inscription** (M-B) — `repartirReprise` produit un article prévu à
  `quantite: 0` (obligatoire à `quantite_defaut` 0, ou optionnel choisi sans quantité) : ligne à 0 F alors que
  `inscrire_eleve` l'ignore. Correctif : écarter dans `retenus` les uniques de quantité < 1. *Estimé : 15 min.
  Croise : tranche 5.* (review database tranche 2 « reprise de l'existant », 2026-11-11)
  **Résolu** : écarté dans `retenus` de `repartirReprise` (tranche 5, 2026-11-11).

- [x] **Début de service hors de l'année pour un import après le dernier mois** (M-C) — un service sans argent
  reçoit `moisDebut` = mois de l'import, au-delà du dernier mois de l'année : sans effet sur le calcul, mais écrit
  tel quel en tranche 5. Correctif : plafonner au dernier mois ou ne pas rattacher. *Estimé : 15 min. Croise :
  tranche 5 (`articles_inscription.mois_debut`).* (review database tranche 2 « reprise de l'existant », 2026-11-11)
  **Résolu** : service sans versement ni début explicite non rattaché, avec avertissement (tranche 5, 2026-11-11).

- [x] **Rattacher les paiements à la bonne période à l'écriture de la reprise** (H-1, à faire dans la tranche 5) —
  `PaiementPrevu.articleIndex` (`src/lib/reprise-repartition.ts`) est une position dans `articles` : un service
  arrêté puis repris a une ligne par période. L'insertion doit garder la correspondance rang → id (fonction SQL avec
  `WITH ORDINALITY`, ou insertion ligne par ligne), jamais l'ordre des ids renvoyés par un insert groupé, sinon un
  paiement de février tombe sur la ligne de novembre (arriéré faux). Écrire `mois_debut`/`mois_fin` dès l'INSERT
  (`proteger_article_inscription` protège ensuite les UPDATE) et ne pas passer par `ajouterArticleInscription`, qui
  refuse une seconde période « déjà en cours ». Test T5 : paiement de février rattaché à la ligne de février.
  *Croise : tranche 5.* (review database tranche 2 « périodes de service », 2026-11-11)
  **Résolu** : une ligne `articles_inscription` par période, `article_index` → id par boucle dans `importer_reprise` (v1.18) ; vérifié en réel (tranche 5, 2026-11-11).

- [ ] **Périodes contiguës d'un service gardées en deux lignes** — « Transport (11/2026-12/2026) ; Transport
  (01/2027) » donne deux lignes de service là où une seule suffirait. Sans effet sur les montants. Correctif possible :
  fusionner les périodes contiguës dans `repartirReprise`, ou avertir. *Estimé : 20 min. Croise : tranche 5.*
  (review database tranche 2 « périodes de service », 2026-11-11)

- [ ] **`bodySizeLimit: "3mb"` vaut pour toutes les Server Actions** — `next.config.ts` : Next 15 n'a pas de réglage
  par action, le corps (3 Mo au lieu de 1) est mis en mémoire avant le contrôle de session. Risque faible, accepté
  pour l'import (2 Mo + enveloppe multipart). À revoir si Next permet une limite par route, ou passer l'envoi par une
  route dédiée. *Estimé : 1 h.* (review security tranche 2 « reprise de l'existant », 2026-11-11)

- [ ] **`formatMois` recrée un `Intl.DateTimeFormat` à chaque appel** — `src/lib/dates.ts` ; `situationInscription`
  l'appelle pour chaque libellé d'article. Un aperçu de 2000 élèves paie ce coût, et la suite de tests de parité de la
  reprise prend ~30 s. Correctif : formateur créé une fois au niveau du module. *Estimé : 15 min. Croise : prochaine
  tranche qui touche `dates.ts`.* (tranche 2 « reprise de l'existant », 2026-11-11)

- [ ] **Test de non-régression SQL du contrôle de période** (H4) — le refus FJ412 d'un service mensuel hors
  `[mois_debut, mois_fin]` (`encaisser_paiement` v1.16) n'a aucun test automatique (Vitest ne couvre que `src/lib`).
  Correctif : script SQL à jouer sur une base de test (mois = début, mois = fin, un mois avant, un mois après, bornes
  NULL, rejeu après changement de période). Les noms de mois sont aussi codés en dur dans la fonction SQL, à garder
  alignés avec `dates.ts`. *Estimé : 1 h. Croise : tranche 5.* (review database tranche 3 « reprise de l'existant », 2026-11-11)

- [x] **Boucle de création des classes sans garde ni durée maximale** (S13) — `importerClassesReprise`
  (`src/app/ecole/import/actions.ts`) : jusqu'à 200 appels `enregistrer_classe` séquentiels hors `try/catch`. Une
  exception réseau ou le timeout de la fonction Vercel fait perdre le compte rendu des classes déjà créées et saute
  `revalidatePath` (l'état reste sain : le rejeu les voit « déjà présentes »). Correctif : `try/catch` par classe
  (échec poussé dans `echecs`), `revalidatePath` dans un `finally`, `maxDuration` explicite ; même schéma pour la
  boucle des élèves. *Estimé : 20 min. Croise : tranche 5.* (reviews security et database tranche 4, 2026-11-11)
  **Résolu** : `try/catch` par classe, `revalidatePath` dans un `finally`, `maxDuration = 60` (tranche 5, 2026-11-11).

- [ ] **Réanalyse complète du fichier à chaque clic** (S10/S13) — créer les classes relance `analyser()` deux fois
  (action puis aperçu recalculé) : parse de 2 Mo et lecture de tous les élèves et parents de l'école. Chemin
  authentifié, risque de charge seulement. À revoir si l'import s'ouvre à d'autres rôles. *Estimé : 30 min.*
  (review security tranche 4, 2026-11-11)

- [ ] **Factoriser le calcul du matricule FayJàng** — `importer_reprise` (v1.18) recopie le calcul de `inscrire_eleve`
  (préfixe de l'année, plus grand numéro + 1, même verrou `matricule:…`). Un changement de format doit être fait aux
  deux endroits. Correctif : une fonction SQL `prochain_matricule(ecole, annee)` appelée par les deux. *Estimé :
  45 min. Croise : toute modification du format de matricule.* (tranche 5 « reprise de l'existant », 2026-11-11)

- [ ] **Mode de paiement des reçus de reprise limité à espèces, virement, chèque** — Wave, Orange Money et Free Money
  sont refusés par `importer_reprise` (règle I5 : référence de transaction obligatoire, qu'un total repris n'a pas).
  Une école qui a tout encaissé par mobile money choisit un autre mode, approximatif ; la mention « Reprise de
  l'existant » sur le PDF (tranche 6) lève l'ambiguïté. Décision métier si besoin d'un mode « Non précisé ».
  (tranche 5 « reprise de l'existant », 2026-11-11)

- [ ] **Import : le fichier est relu et réanalysé à chaque lot de 25** — `importerLotReprise` renvoie le fichier (2 Mo
  au plus) et refait l'aperçu complet, y compris la lecture des élèves et parents de l'école : 80 lots pour 2000
  élèves. Fonctionnel, coûteux. Correctif possible : stocker l'analyse (table temporaire ou cache signé) et ne relire
  que les élèves du lot. *Estimé : 2 h. Croise : gros fichiers.* (tranche 5 « reprise de l'existant », 2026-11-11)
  **Mise à jour** : chaque lot ne relit plus les élèves, parents et inscriptions de l'école (doublons écartés par
  `importer_reprise`, review security tranche 5). Reste : la relecture du fichier à chaque lot.

- [ ] **`importer_reprise` ne vérifie pas la présence des articles obligatoires** — la base garantit l'appartenance au
  catalogue, les quantités, les périodes et les plafonds, mais pas que tous les articles obligatoires de la classe sont
  rattachés (le serveur TypeScript le garantit via `repartirReprise`, et un service sans début après la fin de
  l'année est volontairement non rattaché). Un appel direct à la fonction pourrait omettre un obligatoire. Risque
  limité à l'école elle-même. *Estimé : 30 min.* (tranche 5 « reprise de l'existant », 2026-11-11)

- [ ] **Test de non-régression SQL de `importer_reprise`** — Vitest ne couvre pas le SQL. Script à jouer sur une base
  de test : lot de 26 refusé, doublon rejoué (0 création), plafond dépassé (lot annulé en entier), service repris
  (paiement de février sur la ligne de février), élève sans versement (aucun numéro consommé). *Estimé : 1 h 30.*
  (tranche 5 « reprise de l'existant », 2026-11-11)

- [ ] **Ordre des verrous inscription / import** (H5) — `inscrire_eleve` verrouille le parent puis `matricule:` ;
  `importer_reprise` garde `matricule:` pendant tout le lot. Le parent existant n'est plus verrouillé par l'import
  (ON CONFLICT DO NOTHING), il reste le cas très rare d'un même nouveau téléphone créé en même temps des deux côtés
  (deadlock 40P01, le lot échoue et se rejoue). Correctif : faire prendre `matricule:` avant le parent par
  `inscrire_eleve` (bloc v1.19) ou factoriser le matricule. *Estimé : 1 h. Croise : factorisation du matricule.*
  (review database tranche 5 « reprise de l'existant », 2026-11-11)

- [x] **Versements repris comptés dans les totaux de caisse** (M3) — les reçus de reprise portent `paye_le` = jour
  de l'import et un mode choisi (espèces, virement ou chèque) : tout total par jour, mois ou mode (tableau de bord,
  export) est gonflé. Seul discriminant : `encaisse_par = 'Reprise de l''existant'`. Correctif : exclure ces reçus des
  totaux de caisse, ou ajouter un mode `reprise`. *Estimé : 2 h. Croise : tableau de bord, export, tranche 6.*
  (review database tranche 5 « reprise de l'existant », 2026-11-11)
  **Résolu** : `totauxCaisse` (`src/lib/caisse.ts`) : reprise exclue du jour, du mois, des modes et des derniers paiements, comptée dans l'année (« dont … repris ») ; onglet Paiements : reprise seulement dans « Toute l'année », avec un badge ; export : statut « Reprise de l'existant » (tranche 7, 2026-11-11).

- [ ] **Message d'échec d'un lot d'import trop affirmatif** — `reprise-panel.tsx` affiche « Rien n'a été enregistré
  pour ce lot » même après une coupure réseau ou une réponse inattendue, où le lot a pu être écrit (le rejeu reste
  sûr). Correctif : réserver cette phrase à un refus explicite de la base. *Estimé : 30 min.*
  (review security tranche 5 « reprise de l'existant », 2026-11-11)

- [ ] **Durcissements mineurs de `importer_reprise`** — (1) `jsonb_typeof(..) IS DISTINCT FROM 'array' OR
  jsonb_array_length(..)` dépend de l'ordre d'évaluation du OR (même motif que `inscrire_eleve`) : passer par un
  CASE ; (2) le verrou de `compteurs_recus` est gardé pendant tout le lot : ne pas augmenter `TAILLE_LOT` au-delà
  de 25 ; (3) deux homonymes (même prénom, nom et téléphone) dans le fichier : le second est ignoré sans message de
  ligne ; (4) `revalidatePath` appelé même sans écriture. *Estimé : 45 min.*
  (reviews database et security tranche 5 « reprise de l'existant », 2026-11-11)

- [ ] **Reçu PDF : libellés trop larges et nombre de lignes non plafonné** (S13) — `src/lib/recu-pdf.ts` dessine les
  libellés (jusqu'à 120 caractères) sans mesurer leur largeur : ils chevauchent la colonne Montant ; idem pour le nom
  de l'élève, la classe et le nom de l'école. Le nombre de pages suit le nombre de lignes du lot sans garde-fou
  (borné en pratique par la base). Correctif : couper à ~270 pt avec `widthOfTextAtSize` + « ... », et plafonner les
  lignes (ex. 300). *Estimé : 30 min.* (review security tranche 6 « reprise de l'existant », 2026-11-11)

- [ ] **Totaux SuperAdmin tronqués à 1000 lignes** — `src/app/admin/page.tsx` lit inscriptions et paiements de toutes
  les écoles sans pagination : au-delà de 1000 lignes, les totaux sont faux sans erreur. Correctif : `toutLire`
  (`src/lib/lecture-paginee.ts`) maintenant, agrégat SQL plus tard si le nombre d'écoles grandit. *Estimé : 45 min.*
  (review database tranche 7 « reprise de l'existant », 2026-11-11)

- [ ] **Limite de fréquence sur l'export Excel** (S10) — `/ecole/export` charge toute l'école en mémoire et construit le
  classeur à chaque appel, sans frein pour une école authentifiée (coût limité à ses propres données). Correctif :
  une génération par minute et par école. *Estimé : 1 h.* (review security tranche 7, 2026-11-11)

- [ ] **Détection de formule à l'import incomplète** — `ressembleAUneFormule` (`reprise-validation.ts`) refuse
  `^[=+@]` mais pas `-`, la tabulation ni le retour chariot. L'export neutralise déjà tout (`celluleTexte`) : défense en
  profondeur seulement. Correctif : réutiliser la même expression. *Estimé : 15 min.* (review security tranche 7, 2026-11-11)

- [ ] **Écran « Lecture des données impossible » sans cause** — quand l'école dépasse 50 000 lignes
  (`LectureTropLongue`), la page affiche le même message qu'une panne passagère. Correctif : message dédié
  (« contactez le support »). *Estimé : 10 min.* (review database tranche 7, 2026-11-11)

---

## Décisions tranchées (ne plus rouvrir)

- [x] **Un paiement ne se supprime ni ne se modifie** : annulation motivée seulement,
  reçu barré « ANNULÉ », annulation par reçu entier (lot). (2026-11-07)
- [x] **Le dernier mois peut se payer par tranches** : mois de début et nombre de
  tranches réglés par l'école, tranche incluse dans le reçu de la mensualité, case
  cochée par défaut. (2026-11-08)
- [x] **Commits signés avec l'adresse noreply GitHub** dans ce dépôt (l'adresse Gmail
  n'est pas reliée au compte, Vercel refusait le déploiement). (2026-11-08)
- [x] **Nom de l'application : FayJàng** (identifiants techniques sans accent :
  `fayjang`). (2026-11-08)
- [x] **Réglages d'encaissement fixés par l'école en début d'année** (1er / dernier mois à
  l'inscription, mois payé par tranches) : ils restent au niveau de l'école, pas figés sur
  chaque inscription. (2026-11-08)
- [x] **Départ d'un élève (abandon, transfert)** : une date de départ est enregistrée ; les mois
  jusqu'au mois du départ inclus (mois entamé = dû) restent dus, ceux d'après ne le sont plus
  (ce qui est déjà payé est gardé, pas de remboursement). Restent dus : frais d'inscription,
  frais uniques (tenues…), 1er mois payé à l'inscription. Anciens abandons sans date : ancien
  calcul + bandeau « date de départ manquante ». Le parent voit « Départ enregistré le … ». (2026-11-08)
- [x] **Paiement libre refusé pour un élève parti** (abandon ou transfert). Appliqué dans
  `encaisserPaiement` et l'interface (commit `3e3c4bb`). (2026-11-08)
- [x] **Exception au gel du schéma** pour la seule colonne `inscriptions.date_depart` (ajout pur,
  feature « départ d'un élève »). (2026-11-08)
- [x] **Préfixe des reçus encore « JP- »** — vient de l'ancien nom JàngPay. Passer à
  « FJ- » demande un bloc final qui remplace `numeroter_recu` .(2026-11-09)
- [x] **Inscription d'élève atomique** — fonction SQL `inscrire_eleve` (bloc v1.7 de
  `supabase/schema/05-migrations.sql`) : parent, élève, inscription, articles et reçu d'inscription
  créés en une seule transaction ; un échec n'en laisse aucun et ne consomme pas de numéro de reçu.
  SECURITY INVOKER (et non DEFINER comme prévu au départ) : la RLS École reste appliquée, `ecole_id`
  vient du JWT. Le dû reste calculé en TypeScript (`situationInscription`), la base vérifie seulement
  les plafonds. Tranche 1 : commit `561ff6d` ; tranche 2 : commit `865f9d2`. (2026-11-10)
- [x] **Plafond de lignes sur le calcul du matricule** — le matricule est calculé par `inscrire_eleve`
  (plus grand suffixe numérique + 1, sous verrou), sans lecture plafonnée ni ordre texte ; testé : après
  269999 vient 2610000. Commit `561ff6d`. (2026-11-10)
- [x] **Signature de `inscrire_eleve` gardée en tranche 2** — mêmes 14 paramètres, refus de l'encaissement
  retiré, lignes de paiement validées avant tout cast. Commit `865f9d2`. (2026-11-10)
- [x] **Parent existant à l'inscription** : même téléphone dans l'école = même parent ; son nom et son lien
  ne changent pas (un parent désactivé est réutilisé sans être réactivé). (2026-11-10)
- [x] **Encaissement atomique (paiements simultanés)** — fonction SQL `encaisser_paiement` (bloc v1.8 de
  `supabase/schema/05-migrations.sql`), SECURITY INVOKER : verrou de l'inscription (`FOR NO KEY UPDATE`),
  empreinte des paiements lus par le serveur (tout changement depuis la lecture → FJ412 « Un autre encaissement
  ou une annulation vient d'être enregistré… »), plafonds d'après les tarifs figés de l'inscription, un seul
  INSERT. Le calcul fin reste dans `situationInscription` ; conflit en FJ412 (pas de FJ409) ; pas d'index unique
  sur `paiements`. Testé en preview : deux postes à la même milliseconde → un seul reçu. Commit `013056d`. (2026-11-10)
- [x] **Double-clic sur Encaisser (idempotence)** — clé d'encaissement (`lot_id`) générée par la fiche élève et
  rejouée par `encaisser_paiement` : même clé et même contenu (comparé ligne par ligne) → le reçu existant est
  renvoyé sans rien ajouter ; même clé et autre contenu, ou reçu annulé → refus FJ412. Côté base : commit
  `013056d` ; côté fiche élève : tranche 2 « encaissement atomique ». (2026-11-10)
- [x] **Paiement libre refusé pour un élève parti, aussi en base** — `encaisser_paiement` refuse un paiement libre
  si l'inscription n'est pas active (FJ412). Couvre le seul chemin d'encaissement ; la policy RLS `ecole_encaisse`
  n'a pas changé. Commit `013056d`. (2026-11-10)
- [x] **Version unique de `encaisser_paiement` à vérifier en base** — après application du schéma :
  `SELECT oid::regprocedure FROM pg_proc WHERE proname = 'encaisser_paiement';` doit renvoyer une ligne (PGRST203
  sinon). *Estimé : 2 min. Croise : mise en production de « encaissement atomique ».*
  (plan architect « encaissement atomique », 2026-11-10)
- [X] **Version unique de `inscrire_eleve` à vérifier en base** — après application du schéma, s'assurer qu'une
  seule signature existe : `SELECT oid::regprocedure FROM pg_proc WHERE proname = 'inscrire_eleve';` doit renvoyer
  une ligne (une surcharge donnerait l'erreur PostgREST PGRST203). *Estimé : 2 min. Croise : mise en production
  de « inscription atomique ».* (review database tranche 2 « inscription atomique », 2026-11-10)
- [x] **Opérations multi-étapes atomiques** — `enregistrer_classe` (bloc v1.9) : classe et catalogue en une seule
  transaction, classe verrouillée en FOR NO KEY UPDATE ; `enregistrer_parametres` (bloc v1.11) : réglages et copie
  des classes actives + catalogue vers la nouvelle année en une seule transaction, école verrouillée (FOR NO KEY
  UPDATE), sérialisée avec la création de classe. Année cible ayant déjà des classes : aucune copie, l'école est
  prévenue. SECURITY INVOKER, `ecole_id` du JWT. Tranche 1 : commit `29d748e` ; tranche 2 : commit `2132b6d` ;
  merge `2f254f8`. (2026-11-10)
- [x] **Prix d'article plafonné et produit prix × quantité en bigint** (H4) — CHECK NOT VALID
  `prix_unitaire <= 99999999` sur `articles_classe` (v1.9) et `articles_inscription` (v1.10) ; `inscrire_eleve`
  redéfinie (v1.10) avec `ai.prix_unitaire::bigint * ai.quantite`. Commit `29d748e`. (2026-11-10)
- [x] **Article retiré du catalogue pendant une inscription** — `inscrire_eleve` (v1.10) lit la classe en FOR SHARE :
  elle attend la fin d'un `enregistrer_classe` sur la même classe au lieu de lire un catalogue en cours de
  modification. Testé à deux sessions. Commit `29d748e`. (review database tranche 1 « opérations atomiques »,
  2026-11-10)
- [x] **Fin d'un service jamais avant son dernier mois payé, tenue par la base** — `proteger_article_inscription`
  (bloc v1.13) refuse en FJ412 un `mois_fin` antérieur au dernier mois payé non annulé, quel que soit le chemin ;
  l'inscription est verrouillée en tête de fonction (comme `encaisser_paiement`). Commit `4b4eb76`. (2026-11-10)
- [x] **Article d'élève venu du catalogue de sa classe, tenu par la base** — `verifier_meme_ecole` (bloc v1.14)
  refuse un article d'une autre classe (FJ422), un changement de classe tant que l'élève a des articles de l'ancienne
  (FJ412) et le déplacement d'une ligne de catalogue déjà attribuée (FJ412) ; lectures verrouillées, index partiel sur
  `articles_inscription(article_classe_id)`. Option retenue : refus, pas de remplacement automatique des articles.
  Commit `7ad2109`. (2026-11-10)
- [x] **`updated_at` sur eleves, classes, inscriptions, parents et articles_inscription** (M1) — bloc v1.15, rattrapé
  à `created_at` ; valeur du client ignorée, UPDATE sans changement sans effet. Affiché dans la fiche élève côté École
  seulement (« Dernière modification »), ni page parent ni export. Commit `b340119`. (2026-11-10)
