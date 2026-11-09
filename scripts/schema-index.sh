#!/usr/bin/env bash
# Régénère .claude/SCHEMA-INDEX.md depuis supabase/schema.sql
# v7 : triggers et policies groupés par (nom, table) au lieu du nom seul.
#      Corrige l'affichage des accents (UTF-8).

set -e

SCHEMA="supabase/schema.sql"
OUT=".claude/SCHEMA-INDEX.md"

if [ ! -f "$SCHEMA" ]; then
  echo "❌ $SCHEMA introuvable. Lance depuis la racine du projet."
  exit 1
fi

mkdir -p .claude

# Extrait sans regroupement (Tables, Vues, Fonctions)
extract_simple() {
  local label="$1" grep_re="$2" sed_clean="$3"
  echo "## $label"; echo ""
  local entries
  entries=$(grep -nE "$grep_re" "$SCHEMA" 2>/dev/null | while IFS= read -r l; do
    local ligne="${l%%:*}"; local rest="${l#*:}"; local nom
    nom=$(printf '%s' "$rest" | sed -E "$sed_clean")
    if [ -n "$nom" ] && [ "$nom" != "$rest" ]; then
      printf '%s\t%s\n' "$nom" "$ligne"
    fi
  done)
  local noms
  noms=$(printf '%s' "$entries" | cut -f1 | sort -u | grep -v '^$' || true)
  for nom in $noms; do
    local lignes
    lignes=$(printf '%s' "$entries" | awk -F'\t' -v n="$nom" '$1 == n {print $2}' | sort -n)
    [ -z "$lignes" ] && continue
    local total
    total=$(echo "$lignes" | wc -l | tr -d ' ')
    local derniere
    derniere=$(echo "$lignes" | tail -1)
    if [ "$total" -le 1 ]; then
      echo "- \`$nom\` — L$derniere"
    else
      local mortes
      mortes=$(echo "$lignes" | sed '$d' | tr '\n' ' ' | sed 's/ $//')
      echo "- \`$nom\` — L$derniere **(active)** · remplace L${mortes// /, L}"
    fi
  done
  echo ""
}

# Extrait avec regroupement par (nom, table) : Policies, Triggers
extract_by_table() {
  local label="$1" grep_re="$2" sed_clean="$3"
  echo "## $label"; echo ""
  local entries
  entries=$(grep -nE "$grep_re" "$SCHEMA" 2>/dev/null | while IFS= read -r l; do
    local ligne="${l%%:*}"; local rest="${l#*:}"; local cle
    cle=$(printf '%s' "$rest" | sed -E "$sed_clean")
    if [ -n "$cle" ] && printf '%s' "$cle" | grep -q '|'; then
      printf '%s\t%s\n' "$cle" "$ligne"
    fi
  done)
  local cles
  cles=$(printf '%s' "$entries" | cut -f1 | sort -u | grep -v '^$' || true)
  for cle in $cles; do
    local nom="${cle%%|*}"
    local table="${cle#*|}"
    local lignes
    lignes=$(printf '%s' "$entries" | awk -F'\t' -v n="$cle" '$1 == n {print $2}' | sort -n)
    [ -z "$lignes" ] && continue
    local total
    total=$(echo "$lignes" | wc -l | tr -d ' ')
    local derniere
    derniere=$(echo "$lignes" | tail -1)
    if [ "$total" -le 1 ]; then
      echo "- \`$nom\` sur \`$table\` — L$derniere"
    else
      local mortes
      mortes=$(echo "$lignes" | sed '$d' | tr '\n' ' ' | sed 's/ $//')
      echo "- \`$nom\` sur \`$table\` — L$derniere **(active)** · remplace L${mortes// /, L}"
    fi
  done
  echo ""
}

{
  echo "# Index de schema.sql"
  echo ""
  echo "> **Fichier généré automatiquement.** Ne pas éditer à la main."
  echo "> Régénérer : \`bash scripts/schema-index.sh\`"
  echo ""
  echo "**Total : $(wc -l < "$SCHEMA" | tr -d ' ') lignes.**"
  echo ""

  extract_simple "Tables" \
    '^CREATE TABLE IF NOT EXISTS public\.' \
    's/^CREATE TABLE IF NOT EXISTS public\.([a-z_]+).*/\1/'

  extract_simple "Vues" \
    '^CREATE OR REPLACE VIEW public\.' \
    's/^CREATE OR REPLACE VIEW public\.([a-z_]+).*/\1/'

  extract_simple "Fonctions" \
    '^CREATE OR REPLACE FUNCTION public\.' \
    's/^CREATE OR REPLACE FUNCTION public\.([a-z_]+)\(.*/\1/'

  # Policies : nom|table
  extract_by_table "Policies" \
    '^CREATE POLICY ' \
    's/^CREATE POLICY ([a-z_]+) ON public\.([a-z_]+).*/\1|\2/'

  # Triggers : nom|table (extrait la table après ON public.)
  extract_by_table "Triggers" \
    '^[[:space:]]*CREATE TRIGGER ' \
    's/^[[:space:]]*CREATE TRIGGER ([a-z_]+) .* ON public\.([a-z_]+).*/\1|\2/'

  echo "## Index nommés"
  echo ""
  grep -nE "^[[:space:]]*CREATE (UNIQUE )?INDEX " "$SCHEMA" 2>/dev/null | \
    sed -nE 's/^([0-9]+):[[:space:]]*CREATE (UNIQUE )?INDEX (IF NOT EXISTS )?([a-z_]+).*/- `\4` — L\1/p' || true
  echo ""

  echo "## Contraintes CHECK"
  echo ""
  grep -nE "ADD CONSTRAINT [a-z_]+.*CHECK" "$SCHEMA" 2>/dev/null | \
    sed -nE 's/^([0-9]+):.*ADD CONSTRAINT ([a-z_]+).*CHECK.*/- `\2` — L\1/p' || true
  echo ""

  echo "## Blocs de migration (v1.x)"
  echo ""
  grep -nE "^-- v[0-9]+\." "$SCHEMA" 2>/dev/null | \
    sed -E 's/^([0-9]+):-- (.+)$/- L\1 : \2/' || true
  echo ""

  echo "## Notes pour l'agent"
  echo ""
  echo "- Les blocs v1.x sont en fin de fichier et **remplacent** les"
  echo "  définitions antérieures. La ligne active est la **dernière**."
  echo "- Pour les **triggers** et **policies**, le regroupement est par"
  echo "  \`(nom, table)\`. Un même nom de trigger posé sur 5 tables donne"
  echo "  5 lignes distinctes, toutes actives."
  echo "- Quand tu lis une fonction, un trigger ou une policy, **lis la"
  echo "  version active** (la ligne avec \`(active)\` ou la seule ligne)."
} > "$OUT"

echo "✅ Index généré : $OUT"
echo "   $(wc -l < "$OUT" | tr -d ' ') lignes, $(du -h "$OUT" | cut -f1)"