# 🎓 FayJàng — Suivi de la scolarité des écoles privées

> **Inscriptions, mensualités, paiements et reçus pour les écoles privées du Sénégal.**
> « fay » : payer, « jàng » : étudier, en wolof. Architecture reprise de Cantine Pro.

---

## 📱 Fonctionnalités Clés

1. **Espace École (`/ecole`) :**
   * **Tableau de bord :** élèves inscrits, encaissé du jour et du mois, taux de recouvrement, arriérés, répartition par mode de paiement.
   * **Classes :** tarifs par classe et par année (frais d'inscription, mensualité). Les tarifs sont figés à l'inscription de chaque élève.
   * **Inscriptions :** élève + parent + classe en un écran, matricule automatique, frères et sœurs regroupés par le téléphone du parent, réduction mensuelle (fratrie, bourse), frais d'inscription encaissés tout de suite.
   * **Fiche élève :** grille des mois (payé, partiel, en retard, à venir), encaissement de plusieurs mois en une fois, paiement partiel, espèces / **Wave** / **Orange Money** / **Free Money** / virement / chèque (référence obligatoire pour le mobile money).
   * **Reçus PDF numérotés** (`JP-2026-00001`) par la base : un reçu par encaissement, avec le détail des lignes et le total. Annulation motivée, reçu barré « ANNULÉ ».
   * **Impayés :** arriérés triés, filtre par classe et par nombre de mois de retard, **relance WhatsApp** prête à envoyer avec le lien de suivi du parent.
   * **Paiements :** journal du jour / du mois / de l'année, **export Excel** (paiements + soldes par élève).
   * **Paramètres :** calendrier (mois de la 1ʳᵉ mensualité, nombre de mensualités, jour d'échéance), **dernier mois payé par tranches** (mois de début et nombre de tranches), passage à l'année suivante (classes reprises), changement du code d'accès.

2. **Espace Parent (`/parent/[token]`) :**
   * Accessible sans mot de passe via un lien magique envoyé par WhatsApp.
   * Page serveur légère (aucun JavaScript client), pensée pour la 3G/4G.
   * Tous les enfants du parent, la grille des mois, le reste à payer, les tranches du dernier mois et les reçus PDF.

3. **Console SuperAdmin (`/admin`) :** liste des écoles, élèves suivis, encaissé, changement d'offre, de statut d'abonnement et de date de fin, activation / désactivation.

---

## 🛠️ Stack Technique

* **Framework :** Next.js 15 (App Router, Server Actions, React 19)
* **Styling :** Tailwind CSS
* **Icônes :** Lucide React
* **Base de données :** Supabase (PostgreSQL + RLS). Pas de Supabase Auth : le serveur signe des JWT courts (ES256)
  dont les claims (`role_app`, `ecole_id`, `parent_id`) filtrent chaque table ; ils ne quittent jamais le serveur.
* **Documents :** exceljs (export Excel), pdf-lib (reçus PDF)
* **Déploiement :** Vercel (projet `fayjang`, https://fayjang.vercel.app)

---

## 🚀 Démarrage Local

```bash
# 1. Ouvrir le projet
cd SOLUTIONDEV/JangPay

# 2. Installer les dépendances
npm install

# 3. Configurer l'environnement (voir « Initialisation Supabase » ci-dessous)
cp .env.local.example .env.local

# 4. Lancer le serveur de développement
npm run dev

# 5. Ouvrir dans le navigateur
# http://localhost:3000
```

---

## 🗄️ Initialisation Supabase

1. Créez un projet sur [Supabase](https://supabase.com).
2. Ouvrez l'éditeur SQL et collez le contenu de [`supabase/schema.sql`](./supabase/schema.sql).
3. Cliquez sur **Run** : le script est idempotent et crée ou met à jour les tables (`ecoles`, `acces_ecole`, `classes`,
   `parents`, `eleves`, `inscriptions`, `paiements`, `compteurs_recus`, `tentatives_connexion`), les fonctions
   d'échange, les triggers d'intégrité et toutes les politiques RLS. Relancez-le en entier après chaque mise à jour
   du code. Il ne contient **aucune** donnée de démonstration.
4. Générez la clé de signature des JWT et importez-la dans Supabase (**Project Settings > JWT Keys**) :
   `npx supabase gen signing-key --algorithm ES256`.
5. Renseignez `.env.local` (modèle complet et commentaires dans [`.env.local.example`](./.env.local.example)) :

| Variable | Obligatoire | Rôle |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | oui | Connexion à Supabase (la clé anon seule ne lit aucune table) |
| `SUPABASE_JWT_PRIVATE_KEY` | oui | Clé privée ES256 (JWK) qui signe les JWT courts |
| `SUPABASE_SERVICE_ROLE_KEY` | oui | Réservée à `/admin`, à l'inscription d'une école et au diagnostic |
| `ECOLE_SESSION_SECRET` | oui | Signature des cookies de session École (32 caractères min., `openssl rand -hex 32`) |
| `NEXT_PUBLIC_APP_URL` | oui | URL publique utilisée dans les liens envoyés aux parents |
| `SUPERADMIN_CODE` | pour `/admin` | Code de la console SuperAdmin (12 caractères min.) |
| `DIAGNOSTIC_SECRET` | en production | Protège `/api/diagnostic` (en-tête `x-diagnostic-secret`) |
| `WAVE_NUMERO_PAIEMENT` | non | Numéro Wave affiché aux écoles pour régler l'abonnement |

`/api/diagnostic` indique pour chaque variable si elle est présente (sans afficher sa valeur), si la connexion
Supabase marche et si les JWT sont acceptés. En production, il faut l'appeler avec le secret, sinon la route répond 404 :

```bash
curl -H "x-diagnostic-secret: $DIAGNOSTIC_SECRET" https://fayjang.vercel.app/api/diagnostic
```

---

## 🔐 Accès École & Ouverture d'une École

L'Espace École `/ecole` est protégé par un code d'accès par école (cookie signé, 30 jours ; changer le code
déconnecte toutes les sessions). Une école s'inscrit seule sur **`/inscription`** (30 jours d'essai) et se
connecte ensuite avec son identifiant ou son e-mail. Pour ouvrir une école à la main, dans l'éditeur SQL Supabase :

```sql
-- Le code est stocké à part (table acces_ecole, illisible par les rôles applicatifs), converti en bcrypt par trigger
WITH e AS (
    INSERT INTO public.ecoles (nom, slug, ville, annee_scolaire)
    VALUES ('Nom de l''école', 'nom-ecole', 'Dakar', '2026-2027')
    RETURNING id
)
INSERT INTO public.acces_ecole (ecole_id, code_hash)
SELECT id, encode(digest('CODE-SECRET-ECOLE', 'sha256'), 'hex') FROM e
RETURNING ecole_id;
```

## 🗓️ Principe de fonctionnement

1. **Rentrée** — l'école crée ses classes et leurs tarifs, puis inscrit les élèves (les frais d'inscription
   peuvent être encaissés tout de suite). Chaque parent reçoit son lien de suivi par WhatsApp.
2. **Chaque mois** — la mensualité est due au jour d'échéance (le 5 par défaut). L'administration encaisse
   depuis la fiche élève ; le reçu PDF est remis ou envoyé au parent.
3. **Dernier mois par tranches** (option) — la mensualité du dernier mois est répartie sur plusieurs mois ;
   payer un mois qui porte une tranche l'ajoute au même reçu.
4. **Impayés** — l'onglet Impayés liste les arriérés et prépare les relances WhatsApp. Rien n'est envoyé sans
   un clic de l'école.
5. **Fin d'année** — dans Paramètres, passer à l'année suivante : les classes sont reprises, les élèves sont
   réinscrits depuis leur fiche. L'historique de l'année précédente reste conservé.

## 💳 Abonnements & Console SuperAdmin

* Offres : **Essai** (30 jours à l'inscription), **Standard**, **Premium**. Statuts : essai, actif, expiré, suspendu.
* Console **`/admin`** (code `SUPERADMIN_CODE`) : liste des écoles, élèves suivis, encaissé, changement d'offre,
  de statut et de date de fin, activation / désactivation. Une école désactivée ne peut plus se connecter et ses
  liens parents ne fonctionnent plus.
* `WAVE_NUMERO_PAIEMENT` (optionnel) : numéro Wave affiché aux écoles dans l'onglet Paramètres.

---

## 🧭 Pour les contributeurs

* [`CLAUDE.md`](./CLAUDE.md) : constitution du projet (règles de code, sécurité, argent, vocabulaire).
* [`.claude/WORKFLOW.md`](./.claude/WORKFLOW.md) : cycle de livraison (plan → tranche → dev → reviews → merge).
* [`BACKLOG.md`](./BACKLOG.md) : findings d'audit en attente d'une feature.
* [`docs/mise-en-prod.md`](./docs/mise-en-prod.md) : checklist de mise en production.
* `bash scripts/schema-index.sh` : régénère `.claude/SCHEMA-INDEX.md` après chaque modification du schéma.

> Après chaque mise à jour du schéma, relancez `supabase/schema.sql` en entier dans l'éditeur SQL Supabase :
> le code déployé lirait sinon des colonnes qui n'existent pas encore.
