#!/bin/bash
# Hook PostToolUse : rappel quand supabase/schema.sql est modifié.
fichier=$(jq -r '.tool_input.file_path // .tool_response.filePath // empty')
case "$fichier" in
  */supabase/schema.sql)
    jq -n '{hookSpecificOutput: {hookEventName: "PostToolUse", additionalContext: "schema.sql modifié : mettre à jour src/types/database.ts, garder le SQL idempotent (IF NOT EXISTS), et rappeler à l utilisateur de relancer schema.sql dans l éditeur SQL Supabase avant de déployer."}}'
    ;;
esac
exit 0
