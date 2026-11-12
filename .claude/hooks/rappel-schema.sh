#!/bin/bash
# Hook PostToolUse : rappel quand une source du schéma (supabase/schema/*.sql) est modifiée.
# supabase/schema.sql est généré : s'il est édité à la main, le rappel dit de repasser par les sources.
fichier=$(jq -r '.tool_input.file_path // .tool_response.filePath // empty')
case "$fichier" in
  */supabase/schema/*.sql)
    jq -n '{hookSpecificOutput: {hookEventName: "PostToolUse", additionalContext: "Source du schéma modifiée : lancer bash supabase/scripts/build-schema.sh puis bash scripts/schema-index.sh, mettre à jour src/types/database.ts dans le même commit, garder le SQL idempotent (IF NOT EXISTS), puis s arrêter et rappeler à l utilisateur de relire le diff et de relancer schema.sql dans l éditeur SQL Supabase avant de déployer."}}'
    ;;
  */supabase/schema.sql)
    jq -n '{hookSpecificOutput: {hookEventName: "PostToolUse", additionalContext: "supabase/schema.sql est un fichier GÉNÉRÉ : cette modification sera écrasée au prochain build. Reporter le changement dans la source concernée (supabase/schema/0X-*.sql), puis lancer bash supabase/scripts/build-schema.sh et bash scripts/schema-index.sh."}}'
    ;;
esac
exit 0
