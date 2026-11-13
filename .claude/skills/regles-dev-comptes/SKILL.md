---
name: regles-dev-comptes
description: >
  Règles d'implémentation des comptes, droits, mots de passe, abonnement et console SuperAdmin de FayJàng.
  Charger ce skill dès qu'on modifie utilisateurs-panel.tsx, actions/utilisateurs.ts, changerMonMotDePasse,
  src/lib/securite/droits.ts, utilisateurs.ts, mot-de-passe.ts, abonnement.ts, abonnement-ecole.ts,
  bandeau-abonnement.tsx ou src/app/admin/** (hors login). Contient les invariants (double contrôle des
  droits, règles de F22, mots de passe, session coupée, abonnement en base seulement, nom figé sur les
  reçus), le modèle d'action, les tests manuels à deux comptes et les anti-patterns.
---

# Règles des comptes, droits et SuperAdmin — FayJàng

## Contexte

Depuis F22, une école a **un directeur** (créé à l'ouverture du compte, jamais désactivé) et des
**caissiers** créés par le directeur. Chacun se connecte avec son e-mail et son mot de passe ; le JWT
porte `utilisateur_id` et `role_utilisateur`. Le caissier encaisse ; seul le directeur annule, gère
les classes, les paramètres, l'import, l'export et les comptes. FayJàng (console `/admin`) gère les
abonnements et réinitialise le mot de passe d'un directeur. À venir : **D10**, changer le nom et
l'e-mail d'un directeur.

**Fichiers :**
- `src/components/ecole/utilisateurs-panel.tsx`, `actions/utilisateurs.ts` (`sessionDirecteur()`)
- `src/app/ecole/actions/utilisateurs.ts` : aussi `changerMonMotDePasse` ; helper `refusDroit()` dans `src/app/ecole/actions/_commun.ts`
- `src/lib/securite/droits.ts` : `Droit`, `DROITS_CAISSIER`, `peutFaire()`
- `src/lib/validation/utilisateurs.ts` : `lireSaisieCaissier()` ; `src/lib/validation/mot-de-passe.ts` : `normaliserEmail()`, `erreurMotDePasse()`
- `src/lib/metier/abonnement.ts`, `abonnement-ecole.ts` (`lireAbonnementEcole`, `refusLectureSeule`), `bandeau-abonnement.tsx`
- `src/app/admin/actions/*.ts` (chaque action commence par `clientAdmin()` de `_commun.ts`), les pages de `src/app/admin/`, `src/components/admin/*.tsx`, `src/lib/metier/admin-ecoles.ts`

**Fonctions SQL (version active dans `.claude/SCHEMA-INDEX.md`) :** `creer_utilisateur_ecole`,
`changer_statut_utilisateur`, `reinitialiser_mot_de_passe_utilisateur`, `reinitialiser_mot_de_passe_directeur`,
`changer_mon_mot_de_passe`, `lister_utilisateurs_ecole`, `exiger_directeur`, `session_utilisateur_valide`,
`echanger_utilisateur_ecole`, `situation_abonnement`, `abonnement_ecole`, `nom_utilisateur_courant`.

## Invariants (non négociables)

### C1 — Un droit se contrôle deux fois
Serveur : `peutFaire(session.role, droit)` (ou `refusDroit`, `sessionDirecteur`) **avant** toute lecture.
Base : `exiger_directeur()` dans la fonction, ou policy filtrée par `jwt_role_utilisateur()`. L'interface
masque en plus, sans que ce soit une protection. Un nouveau droit = une valeur de `Droit` + son test.

### C2 — Règles de F22 (décisions du 2026-11-12 et 2026-11-13)
- Deux rôles fixes : `directeur`, `caissier`.
- Un seul directeur par école ; l'école ne le crée ni ne le désactive.
- Caissier désactivé réactivable ; 20 comptes au plus, directeur et désactivés compris.
- Un e-mail = un seul compte dans tout FayJàng (unicité en base, `idx_utilisateurs_ecole_email`).
- Pas d'obligation de changer un mot de passe provisoire.
- Nom « Reprise de l'existant » et variantes interdits (`nomUtilisateurReserve`).

### C3 — Mots de passe
`hashCode(motDePasse)` côté serveur, le hash part dans la RPC ; le mot de passe n'est ni journalisé,
ni renvoyé, ni remis dans un message. Saisie contrôlée par `erreurMotDePasse()` ; e-mail par
`normaliserEmail()`.

### C4 — Session coupée
Désactiver un compte, changer son mot de passe (ou son e-mail, D10) doit invalider sa session au clic
suivant : c'est `session_utilisateur_valide` en base qui le garantit. Toute nouvelle fonction qui
change un identifiant vérifie qu'elle déclenche ce mécanisme (à lire dans la version active).

### C5 — Abonnement en base seulement
`situation_abonnement` / `abonnement_ecole()` décident ; `abonnement.ts` ne fait que lire
(`lireSituationAbonnement`) et afficher. `controlerAbonnementAdmin` ne contrôle que la saisie du
SuperAdmin (« Actif » exige une date de fin).

### C6 — Nom figé sur les reçus
`paiements.encaisse_par` garde le nom au moment de l'encaissement. Renommer un utilisateur (D10) ne
touche aucun paiement existant.

### C7 — Console SuperAdmin
Chaque action commence par `if (!(await isAdmin())) return …`. `createAdminClient()` n'est permis
qu'ici (avec `/inscription` et le diagnostic). Erreurs journalisées avec `error.code` seulement.

## Modèle d'action (Espace École, directeur seulement)

```ts
export async function renommerUtilisateur(id: string, nom: string): Promise<Resultat> {
  const s = await sessionDirecteur();                     // session + peutFaire(role, "utilisateurs")
  if (typeof s === "string") return { success: false, message: s };
  if (!estUuid(id)) return { success: false, message: "Compte introuvable." };
  const saisie = /* validation à la main, nomUtilisateurReserve */;
  const { error } = await s.supabase.rpc("renommer_utilisateur", { p_id: id, p_nom: saisie });
  if (error) return { success: false, message: messageErreur("utilisateurs", error) };   // exiger_directeur en base
  revalidatePath("/ecole");
  return { success: true, message: "Nom modifié." };
}
```

## Tests manuels obligatoires (deux comptes)

Avec l'école de test (`docs/compte-test.local.md`) : un compte directeur et un compte caissier,
deux navigateurs (ou une fenêtre privée). Jamais une vraie école sans accord.
- **C-A Création** : le directeur crée un caissier ; e-mail déjà utilisé ailleurs → refus lisible ;
  21e compte → refus.
- **C-B Droits** : le caissier encaisse ; il ne voit pas Classes / Paramètres / Importer / Utilisateurs
  et l'appel direct de l'action est refusé par le serveur.
- **C-C Désactivation** : le directeur désactive le caissier → le caissier est renvoyé au login au clic
  suivant ; réactivation → il se reconnecte.
- **C-D Mot de passe** : réinitialisation par le directeur → ancienne session coupée, nouveau mot de
  passe accepté ; moins de 8 caractères → refus.
- **C-E Reçus** : après un renommage, un ancien reçu garde l'ancien nom, un nouveau porte le nouveau.
- **C-F Abonnement** : école passée « Expiré » dans `/admin` → bandeau et écritures refusées ;
  consultation, PDF, export restent permis.
- **C-G Console** : sans session admin, chaque action `/admin` renvoie « Session expirée. ».

## Anti-patterns

| Anti-pattern | Correction |
|---|---|
| `if (role === "directeur")` dans une action | `peutFaire(role, droit)` (C1) |
| Droit contrôlé seulement en masquant le bouton | Contrôle serveur + base (C1) |
| `update` direct sur `utilisateurs_ecole` depuis l'action | Fonction SQL avec `exiger_directeur` |
| Mot de passe dans un `console.*` ou dans le message de retour | Rien du secret ne sort (C3) |
| État d'abonnement recalculé avec des dates en TypeScript | `abonnement_ecole()` (C5) |
| `update` des `paiements.encaisse_par` après un renommage | Nom figé (C6) |
| Action `/admin` sans `isAdmin()` en première ligne | C7 |
| `createAdminClient()` dans `src/app/ecole/` | `createClientEcole(utilisateur)` |
| « Aucun compte avec cet e-mail » à la connexion | Message générique |

## Commandes de diagnostic rapide

```bash
grep -rn "createAdminClient\|service_role" src/app/ecole/ src/lib/ | grep -v "lib/supabase/admin.ts"
grep -rn "role === \|role !== " src/app/ src/lib/ | grep -v test
grep -rn "console\.\(log\|error\)" src/app/ecole/actions/utilisateurs.ts src/app/admin/actions/*.ts
grep -n "export async function" src/app/admin/actions/*.ts   # chacune doit commencer par clientAdmin() (ou appeler listerEcoles)
```

## Reviews habituelles

- Toute tranche de ce périmètre → `security-reviewer` sur l'action ou la page nommée.
- Fonction SQL, policy ou appel `.rpc()` modifié → `database-reviewer` sur l'objet nommé en plus.
- Libellé ou mise en page de l'onglet Utilisateurs, sans nouvelle donnée lue → aucune.
