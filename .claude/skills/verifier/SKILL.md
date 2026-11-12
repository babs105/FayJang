---
name: verifier
description: Vérifier un changement dans FayJàng avant de le considérer comme terminé ou de le pousser - types, règles du projet, build et contrôle visuel dans la preview.
---

# Vérifier un changement

1. **Types et tests** : `npx tsc --noEmit`, puis `npm test` (Vitest). Corriger toute erreur avant de continuer.
2. **Règles du projet** sur le diff (`git diff`) :
   - chaque requête d'une action École passe par `createClientEcole(ecoleId)` et est filtrée par `ecole_id` ; `createAdminClient()` n'apparaît que dans `/admin`, `/inscription` et `/api/diagnostic` ;
   - toute nouvelle page, action ou route privée vérifie sa session en tête (il n'y a pas de middleware) ;
   - toute nouvelle table ou tout nouvel accès d'un rôle a sa politique RLS dans les sources du schéma (`supabase/schema/*.sql`, puis `build-schema.sh`) ;
   - aucun paiement supprimé ou modifié : seulement annulé avec motif ; les montants sont recalculés côté serveur ;
   - pas de `new Date()` brut pour une date métier (utiliser `todayDakar()`) ;
   - textes d'interface en français ;
   - si le schéma a changé : `supabase/schema.sql` et `.claude/SCHEMA-INDEX.md` sont régénérés, `src/types/database.ts` est à jour et l'utilisateur est prévenu de relancer le schéma.
3. **Interface** (si un écran a changé) : preview `fayjang` (port 3126), qui lit la **vraie base** Supabase.
   Vérifier la console et l'affichage, aussi en largeur mobile (375 px). Ne pas créer, modifier ni envoyer de
   données réelles (élèves, paiements) sans l'accord de l'utilisateur. L'Espace École demande une connexion :
   c'est à l'utilisateur de se connecter.
4. **Avant un push** : `NEXT_DIST_DIR=.next-build npm run build` doit réussir.

Rapporter ce qui a été vérifié et ce qui ne l'a pas été.
