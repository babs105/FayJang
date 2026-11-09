#!/usr/bin/env bash
# Concatène supabase/schema/*.sql en supabase/schema.sql (dans l'ordre d'exécution).
# L'ordre N'EST PAS numérique : 03 (fonctions jwt_*) doit passer avant 02 (policies)
# parce que les policies utilisent jwt_role_app(), jwt_ecole_id(), jwt_parent_id().
# Ne jamais éditer supabase/schema.sql à la main : éditer les fichiers sources.

set -e

SRC="supabase/schema"
OUT="supabase/schema.sql"

if [ ! -d "$SRC" ]; then
  echo "❌ Dossier $SRC introuvable."
  exit 1
fi

# En-tête
{
  echo "-- =============================================================================="
  echo "-- FAYJÀNG — SCHÉMA SUPABASE"
  echo "-- Fichier GÉNÉRÉ par supabase/scripts/build-schema.sh. Ne pas éditer à la main."
  echo "-- Sources : supabase/schema/*.sql"
  echo "-- =============================================================================="
  echo ""
} > "$OUT"

# Concaténation DANS L'ORDRE D'EXÉCUTION (pas l'ordre numérique)
for f in 01-tables 03-fonctions 02-securite 04-triggers 05-migrations; do
  if [ ! -f "$SRC/$f.sql" ]; then
    echo "❌ $SRC/$f.sql introuvable."
    exit 1
  fi
  echo "" >> "$OUT"
  echo "-- ------------------------------------------------------------------------------" >> "$OUT"
  echo "-- $f.sql" >> "$OUT"
  echo "-- ------------------------------------------------------------------------------" >> "$OUT"
  echo "" >> "$OUT"
  cat "$SRC/$f.sql" >> "$OUT"
done

echo "✅ $OUT régénéré ($(wc -l < "$OUT" | tr -d ' ') lignes)"