# Backlog — FayJàng

> **Backlog de bugs et de dette** : arrivent ici les bugs dont la correction a été reportée
> (le code livré fait autre chose que ce que disent le feature spec, `CLAUDE.md` ou une
> décision tranchée) et les findings de review `impact: maintien` non corrigés (rien n'est faux
> aujourd'hui, mais une faiblesse précise du code cassera ou deviendra exploitable). Un bug dans ce fichier **n'est pas une urgence**. Il attend qu'une
> feature le croise.
>
> Règles :
> - Après une review, seuls les bugs mineurs et la dette `impact: maintien` non corrigés s'écrivent ici.
>   Un besoin ou une piste ne s'écrit pas ici, et ni un reviewer ni un agent dev n'en signale plus : une nouvelle feature vient de l'humain.
> - Ne rien corriger depuis ce fichier sans passer par `architect`.
> - Ne rien supprimer sans avoir la preuve que c'est fait (commit, PR, numéro de ligne).
> - Les décisions tranchées (métier, projet, risques acceptés) ne sont pas ici : `docs/feature-spec.md`, section 9.
> - Un bug corrigé passe en « Bugs corrigés » avec sa preuve (commit) ; il ne se rouvre pas sans raison nouvelle.
> - Le dev (un agent `dev-*` ou la session principale) gère ce fichier avec l'autorisation de l'humain :
>   il **ajoute** sans demander les bugs et la dette non corrigés de sa tranche ; il **coche, supprime, modifie**
>   une entrée ou la passe en « Bugs corrigés » seulement après l'accord explicite de l'humain.
> - Classement (détail dans `.claude/WORKFLOW.md`, section « Le backlog ») :
>   - **Bug à planifier** dès qu'un de ces points est vrai : plus d'1 h de travail, touche `schema.sql`,
>     l'auth ou l'argent (encaissement, reçus, soldes), plus de 2 fichiers, ou décision métier à prendre ;
>   - **Bug mineur** sinon : correctif court et localisé.
>   - **Dette** : même critère de taille, avec la mention `impact: maintien` dans l'entrée.
>   - Une nouvelle entrée s'ajoute à la fin de sa section, avec son origine (review, tranche, date).

---

## Bugs mineurs à planifier (avec architect)

_Aucun bug à planifier en attente._

---

## Bugs mineurs ou Dette technique & Sécurité (à corriger quand une feature croise le sujet)
- [ ] **Mobile money dans les reçus de reprise** | Reprendre un versement fait par
  Wave ou Orange Money | Tranche 5 « reprise de l'existant »  (2026-11-11) | Référence de transaction obligatoire ou non pour un versement ancien, ou mode « Non précisé » |(Référence facultative uniquement pour l'import)

- [ ] **Commentaires de cellule écrits par openpyxl illisibles par exceljs** — un classeur produit par un outil qui
  écrit ses commentaires comme openpyxl fait échouer `lireClasseur` (« Fichier Excel illisible »). Le modèle n'a plus de
  commentaires ; un fichier enregistré depuis Excel ou LibreOffice n'est pas concerné. Correctif si une école bute
  dessus : retirer les commentaires avant le chargement, ou message dédié. *Estimé : 1 h. Croise : V2 de l'import
  (fichiers d'école tels quels).* (tranche 1 « reprise de l'existant », 2026-11-11)

- [ ] **Limites de fréquence sur l'export et l'analyse d'import** | Aucun changement visible ; le serveur est protégé | Reviews security des tranches 1 et 7 « reprise de l'existant » (S10, 2026-11-11) | Seuils (une génération par minute et par école ? 10 analyses par 10 min ?) |
- [ ] **Tests de non-régression SQL** | Aucun changement visible ; les fonctions `encaisser_paiement` et `importer_reprise` sont testées sur une base | Review database de la tranche 3 et tranche 5 « reprise de l'existant » (H4, 2026-11-11) | Base de test dédiée |
- [ ] **Import : analyse du fichier gardée entre les étapes** | Aucun changement visible ; un gros fichier s'importe plus vite (le fichier n'est plus relu ni réanalysé à chaque clic et à chaque lot de 25) | Review security de la tranche 4 et tranche 5 « reprise de l'existant » (S10/S13, 2026-11-11) | Où garder l'analyse : table temporaire ou cache signé |

- [ ]**Sauvegarde régulière des paiements**  L'école et FayJàng gardent une copie hors de la base  `docs/mise-en-prod.md`, section 5  Export mensuel par école, ou offre Supabase avec sauvegardes 

---

## Bugs corrigés (avec la preuve, ne plus rouvrir)

- [x] **Inscription d'élève atomique** — fonction SQL `inscrire_eleve` (bloc v1.7 de
  `supabase/schema/05-migrations.sql`) : parent, élève, inscription, articles et reçu d'inscription
  créés en une seule transaction ; un échec n'en laisse aucun et ne consomme pas de numéro de reçu.
  SECURITY INVOKER (et non DEFINER comme prévu au départ) : la RLS École reste appliquée, `ecole_id`
  vient du JWT. Le dû reste calculé en TypeScript (`situationInscription`), la base vérifie seulement
  les plafonds. Tranche 1 : commit `561ff6d` ; tranche 2 : commit `865f9d2`. (2026-11-10)
- [x] **Plafond de lignes sur le calcul du matricule** — le matricule est calculé par `inscrire_eleve`
  (plus grand suffixe numérique + 1, sous verrou), sans lecture plafonnée ni ordre texte ; testé : après
  269999 vient 2610000. Commit `561ff6d`. (2026-11-10)
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
- [x] **Service mensuel encaissé hors de sa période** (H4) — `encaisser_paiement` (bloc v1.16) refuse en FJ412 un mois
  hors de `[mois_debut, mois_fin]` d'un service mensuel (bornes NULL = année entière), après le rejeu ; message
  « Transport : mars 2027 est hors de la période du service (…) ». Commit `af25822`. (2026-11-11)
- [x] **Reprise de l'existant : rattachement exact des articles et des paiements** (H-1, M-B, M-C) — `importer_reprise`
  (bloc v1.18) écrit une ligne `articles_inscription` par période d'un service (arrêté puis repris), `mois_debut` /
  `mois_fin` à l'INSERT, et rattache chaque paiement à sa ligne par `article_index` (boucle, jamais l'ordre d'un insert
  groupé) ; un frais unique de quantité 0 n'est pas rattaché ; un service sans versement ni début explicite qui
  commencerait après la fin de l'année non plus. Vérifié en réel (élève « Repris », Transport octobre puis novembre).
  Commit `fb07b06`. (2026-11-11)
- [x] **Import robuste aux coupures et aux grosses écoles** (S7, S13) — lecture complète qui refuse au-delà du plafond au
  lieu de tronquer (doublons écartés aussi en base par `importer_reprise`) ; boucles de création des classes et des
  élèves protégées (`try/catch`, `revalidatePath` dans un `finally`, `maxDuration = 60`). Commits `fb07b06`, `4d1dad0`.
  (2026-11-11)
- [x] **Espace École et export lus en entier** — lecture par curseur sur l'id (`src/lib/lecture-paginee.ts`), `.in()`
  par paquets de 150 inscriptions, plafond de 50 000 lignes : plus de liste ni de solde tronqué à 1000 lignes, et une
  écriture pendant la lecture ne duplique ni ne saute de ligne. L'import utilise le même helper. Commit `4d1dad0`. (2026-11-11)
- [x] **Reçus de reprise hors des totaux de caisse** — `totauxCaisse` (`src/lib/caisse.ts`) : la reprise ne compte ni
  dans le jour, ni dans le mois, ni par mode, ni dans les derniers paiements ; elle compte dans l'année (« dont …
  repris »). Onglet Paiements : seulement dans « Toute l'année », avec un badge ; export : statut « Reprise de
  l'existant ». Commit `4d1dad0`. (2026-11-11)
- [x] **Formules Excel neutralisées dans l'export** — `celluleTexte` (`src/lib/export-sur.ts`) préfixe d'une apostrophe
  tout texte libre commençant par =, +, -, @, tabulation ou retour chariot (téléphones +221 laissés tels quels).
  Commit `4d1dad0`. (2026-11-11)
- [x] **En-têtes de sécurité** (S9) — `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: no-referrer` (le lien magique du parent ne part vers aucun autre site) et `Permissions-Policy` sur
  toutes les réponses (`headers()` de `next.config.ts`), plus une `Content-Security-Policy` tout en `'self'`
  (`frame-ancestors 'none'`, `form-action 'self'` ; `'unsafe-inline'` gardé pour Next, faute de middleware pour des
  nonces). Vérifié en preview : en-têtes servis, Espace École (6 onglets), reçu PDF, export, connexion et accueil sans
  erreur de console. Commit `ce9f0b6`. (2026-11-11)
- [x] **ESLint configuré** — `npm run lint` lance `eslint .` (`eslint.config.mjs`, règles Next + TypeScript) : 0 erreur ;
  les `any` volontaires restent en avertissement. Commit `ce9f0b6`. (2026-11-11)
- [x] **Dates saisies : une date inexistante est refusée** — `isDateValide` (`src/lib/dates.ts`) contrôle par
  aller-retour ISO : le 31 février ou le 29 février d'une année non bissextile sont refusés (date de naissance, fin
  d'abonnement). Tests dans `src/lib/dates.test.ts`. Commit `ce9f0b6`. (2026-11-11)
- [x] **`inscription_id` validé en UUID dans `encaisserPaiement`** (S7) — `estUuid()` avant toute requête, message
  « Inscription introuvable. » (`src/app/ecole/actions.ts`). Commit `ce9f0b6`. (2026-11-11)
- [x] **`formatMois` : formateur créé une seule fois** — `FORMAT_MOIS` au niveau du module (`src/lib/dates.ts`), test
  dans `src/lib/dates.test.ts`. Commit `ce9f0b6`. (2026-11-11)
- [x] **Contrainte violée de `modifierInscription` reconnue par son nom** — `contrainteViolee()` (`src/lib/erreurs.ts`) lit
  le nom de la contrainte de l'erreur 23514 : date de départ, réduction, sinon message générique. Le nom automatique
  de la contrainte de réduction (`inscriptions_check`) n'a pas été vérifié en base. Commit `d38b5f1`. (2026-11-11)
- [x] **Classe, élève et date de naissance contrôlés à l'inscription** (S7) — `estUuid()` sur `classe_id` et `eleve_id`,
  date de naissance future refusée à l'inscription et à la modification (`src/app/ecole/actions.ts`). Commit `d38b5f1`. (2026-11-11)
- [x] **Confirmation de changement d'année exacte** — le texte dit « si cette année n'a pas encore de classes »
  (`parametres-panel.tsx`). Commit `d38b5f1`. (2026-11-11)
- [x] **« Rien à encaisser » signalé par un indicateur** (S7) — constante `RIEN_A_ENCAISSER` (`src/lib/scolarite.ts`) et
  drapeau `rienAEncaisser` renvoyé par `lignesPaiementInscription`, avec test. Commit `d38b5f1`. (2026-11-11)
- [x] **Périodes contiguës d'un service fusionnées** — `repartirReprise` ne garde qu'une ligne quand deux périodes se
  suivent sans mois d'arrêt ; montants inchangés (test de parité). Commit `d38b5f1`. (2026-11-11)
- [x] **Lot d'import à l'issue incertaine** — après une réponse inattendue ou une coupure, l'écran dit que le lot a
  peut-être été enregistré et qu'on peut le reprendre sans risque ; « Rien n'a été enregistré » est réservé au refus
  de la base (`import/actions.ts`, `reprise-panel.tsx`). Commit `d38b5f1`. (2026-11-11)
- [x] **Reçu PDF : textes coupés et détail plafonné** (S13) — école, élève, classe et libellés coupés avec « ... » par
  `widthOfTextAtSize` ; au-delà de 300 lignes, le reste est regroupé en « Autres lignes (n) », total exact
  (`src/lib/recu-pdf.ts`, tests dans `recu-pdf.test.ts`). Contrôlé sur un reçu de test, pas en preview. Commit `d38b5f1`. (2026-11-11)
- [x] **Totaux SuperAdmin lus en entier** — `toutLire` dans `src/app/admin/page.tsx`, bandeau si les totaux sont
  indisponibles. Commit `d38b5f1`. (2026-11-11)
- [x] **Détection de formule à l'import alignée sur l'export** — `ressembleAUneFormule` réutilise `DEBUT_FORMULE`
  (`src/lib/export-sur.ts`) : =, +, -, @, tabulation, retour chariot. Commit `d38b5f1`. (2026-11-11)
- [x] **Écran dédié quand l'école dépasse le nombre de lignes** — message « contactez le support » distinct de la panne
  passagère (`src/app/ecole/page.tsx`). Commit `d38b5f1`. (2026-11-11)
- [x] **Paiement protégé de la suppression** — trigger `trg_interdire_suppression_paiement` (BEFORE DELETE), y compris
  depuis l'éditeur SQL ; nettoyage de tests : `SET LOCAL fayjang.allow_paiement_delete = 'on'` dans la transaction. Bloc v1.19, commit `626d80b`, testé sur une base Postgres locale ; appliqué sur Supabase en production le 2026-11-12. (2026-11-12)
- [x] **Message de classe désactivée** — `inscrire_eleve` répond « Classe introuvable ou désactivée. ». Bloc v1.19, commit `626d80b`, testé sur une base Postgres locale ; appliqué sur Supabase en production le 2026-11-12. (2026-11-12)
- [x] **Parent connu non réécrit à l'inscription** — `ON CONFLICT DO NOTHING` puis lecture, comme l'import. Bloc v1.19, commit `626d80b`, testé sur une base Postgres locale ; appliqué sur Supabase en production le 2026-11-12. (2026-11-12)
- [x] **Un message FJ422 par cause à l'inscription** — nombre de lignes, forme, libellé, doublon, mois hors année,
  article non encaissable, montant au-delà du dû ; les contrôles ne changent pas. Bloc v1.19, commit `626d80b`, testé sur une base Postgres locale ; appliqué sur Supabase en production le 2026-11-12. (2026-11-12)
- [x] **Verrou de lot dans `inscrire_eleve`** (M4) — même verrou « lot: » que `encaisser_paiement`. Bloc v1.19, commit `626d80b`, testé sur une base Postgres locale ; appliqué sur Supabase en production le 2026-11-12. (2026-11-12)
- [x] **Matricule FayJàng factorisé** — `prochain_matricule(annee)`, appelée par `inscrire_eleve` et `importer_reprise`. Bloc v1.19, commit `626d80b`, testé sur une base Postgres locale ; appliqué sur Supabase en production le 2026-11-12. (2026-11-12)
- [x] **Ordre des verrous inscription / import** (H5) — le verrou « matricule: » est pris avant l'écriture du parent des
  deux côtés. Corrigé par construction, sans test de concurrence. Bloc v1.19, commit `626d80b`, testé sur une base Postgres locale ; appliqué sur Supabase en production le 2026-11-12. (2026-11-12)
- [x] **Articles obligatoires vérifiés par `importer_reprise`** — un élève à qui il manque un article obligatoire de sa
  classe est refusé ; exception gardée : service sans versement après la fin de l'année. Bloc v1.19, commit `626d80b`, testé sur une base Postgres locale ; appliqué sur Supabase en production le 2026-11-12. (2026-11-12)
- [x] **Durcissements de `importer_reprise`** — `CASE` devant `jsonb_array_length` (aussi dans `inscrire_eleve`) ;
  `TAILLE_LOT` documenté à 25 au plus (`src/lib/reprise-lots.ts`) ; homonymes et `revalidatePath` réglés par
  `d38b5f1`. Bloc v1.19, commit `626d80b`, testé sur une base Postgres locale ; appliqué sur Supabase en production le 2026-11-12. (2026-11-12)
