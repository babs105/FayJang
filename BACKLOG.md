# Backlog — FayJàng

> Les findings d'audit qui ne sont pas corrigés dans la PR courante arrivent ici.
> Un finding dans ce fichier **n'est pas une urgence**. Il attend qu'une feature
> le croise.
>
> Règles :
> - Ne rien corriger depuis ce fichier sans passer par `architect`.
> - Ne rien supprimer sans avoir la preuve que c'est fait (commit, PR, numéro de ligne).
> - Une décision tranchée ne se rouvre pas sans raison nouvelle.
> - L'agent dev (`dev-encaissement`) peut **ajouter** des findings non corrigés de sa tranche.
>   Seul l'humain coche, supprime, modifie une entrée ou écrit dans « Décisions tranchées ».

---

## Chantiers (feature-scale, à planifier avec architect)

- [ ] **Inscription d'élève atomique** — `inscrireEleve` crée le parent, l'élève,
  l'inscription puis le paiement des frais en plusieurs requêtes ; en cas d'échec,
  le code supprime ce qu'il a créé, mais un parent créé reste en place et une coupure
  réseau au mauvais moment peut laisser un élève sans inscription. Correctif : fonction
  SQL `inscrire_eleve(...)` (SECURITY DEFINER, contrôle `role_app = 'ecole'`) qui fait
  tout dans une transaction. *Estimé : 1 jour. Croise : import Excel des élèves.*

- [ ] **Double encaissement sur double envoi** — chaque appel de `encaisserPaiement`
  crée un nouveau `lot_id` : deux envois rapprochés (réseau lent, double-clic avant
  désactivation du bouton) créent deux reçus. Le bouton est désactivé pendant l'envoi.
  Correctif : clé d'idempotence générée à l'ouverture du formulaire et contrainte
  UNIQUE `(ecole_id, lot_id)` sur la première ligne du lot. *Estimé : 4 h. Croise :
  toute évolution de l'encaissement.*

- [ ] **Encaissement atomique (paiements simultanés)** — `encaisserPaiement` et
  `inscrireEleve` (`src/app/ecole/actions.ts`) recalculent le reste dû puis insèrent
  sans verrou : deux encaissements simultanés sur la même inscription (deux onglets,
  double clic) peuvent surpayer. Correctif : fonction SQL `encaisser(...)`
  SECURITY DEFINER (`search_path` fixé, REVOKE, contrôle `role_app = 'ecole'`) qui
  verrouille l'inscription (`FOR UPDATE`), recalcule et insère le lot. Complète
  l'entrée « Double encaissement sur double envoi » (voir ci-dessus).
  *Estimé : 0,5 jour. Croise : prochaine évolution de l'encaissement.*

- [ ] **Opérations multi-étapes non atomiques** — `enregistrerClasse` (classe puis
  catalogue ligne par ligne), `inscrireEleve` (parent, élève, inscription, articles,
  paiement) et la copie d'année de `enregistrerParametres` : en cas d'échec au milieu,
  l'état reste partiel ; les rollbacks côté code ne couvrent pas tout. Correctif : une
  RPC SQL transactionnelle par opération. *Estimé : 1 jour. Croise : « Inscription
  d'élève atomique », import Excel.*

---

## Corrections mineures (à appliquer quand une feature croise le sujet)

- [ ] **Headers de sécurité absents** (S9) — aucun `X-Frame-Options`,
  `X-Content-Type-Options`, `Referrer-Policy`, CSP dans `next.config.ts`. Le
  `Referrer-Policy` compte : l'URL de la page parent contient le token. Correctif :
  `headers()` dans `next.config.ts`. *Estimé : 1 h. Croise : prochaine tranche sur /p/[token].*

- [ ] **Préfixe des reçus encore « JP- »** — vient de l'ancien nom JàngPay. Passer à
  « FJ- » demande un bloc final qui remplace `numeroter_recu` ; les reçus déjà émis
  gardent « JP- ». *Estimé : 30 min. Croise : première mise en service réelle (à faire
  avant les premiers vrais reçus).*

- [ ] **`updated_at` absent hors `acces_ecole`** (M1) — aucune trace de la dernière
  modification d'un élève, d'une classe ou d'une inscription. *Estimé : 2 h. Croise :
  journal des modifications.*

- [ ] **Node.js 20 en local** — `@supabase/supabase-js` annonce la fin du support de
  Node 20. Vercel est déjà en 26.x. *Estimé : 15 min. Croise : prochaine mise à jour des dépendances.*

- [ ] **Rotation des secrets de développement** — la clé de signature JWT et
  `ECOLE_SESSION_SECRET` du `.env.local` ont été affichés en clair dans un terminal
  le 2026-11-07. Ne pas les réutiliser en production. *Estimé : 15 min. Croise :
  configuration de la production Vercel.*

- [ ] **Invariants des articles tenus seulement par le code** — la base ne vérifie pas
  que `articles_inscription.article_classe_id` appartient à la classe de l'inscription,
  ni que `mois_fin` reste ≥ au dernier mois payé (trigger `proteger_article_inscription`,
  `supabase/schema.sql`). Correctif : contrôles dans `verifier_meme_ecole` et
  `proteger_article_inscription`. *Estimé : 2 h. Croise : tout import de données.*

- [ ] **Frais d'inscription d'un élève en abandon** — `situationInscription`
  (`src/lib/scolarite.ts`) plafonne mensualités et articles à ce qui est payé en cas
  d'abandon, mais pas les frais d'inscription : l'arriéré et la relance WhatsApp
  réclament encore des frais non payés. Décision métier à prendre (plafonner ou garder
  la dette). *Estimé : 15 min. Croise : règles de gestion des abandons.*

- [ ] **Paiement libre sur inscription non active** — `encaisserPaiement` accepte un
  paiement libre (hors catalogue) sur une inscription en abandon ou transférée.
  Décision métier, puis refuser si `statut !== 'active'`. *Estimé : 10 min. Croise :
  règles de gestion des abandons.*

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
