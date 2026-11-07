#!/bin/bash
# Toute écriture sur un fichier .sql (dont supabase/schema.sql) demande l'accord explicite de l'humain :
# Claude Code affiche la modification et attend sa validation au lieu de l'appliquer directement.
input=$(cat)
file_path=$(echo "$input" | jq -r '.tool_input.file_path // empty')

if [[ "$file_path" == *.sql ]]; then
  jq -n --arg fichier "$file_path" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: ("Modification d'\''un fichier SQL (" + $fichier + ") : vérifiez le bloc avant d'\''accepter. Pensez ensuite à relancer schema.sql dans Supabase.")
    }
  }'
  exit 0
fi

exit 0
