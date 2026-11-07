#!/bin/bash
# Bloque l'introduction de service_role hors de src/lib/supabase/admin.ts
input=$(cat)
tool=$(echo "$input" | jq -r '.tool_name // empty')
file_path=$(echo "$input" | jq -r '.tool_input.file_path // empty')
# Write (content), Edit (new_string) et MultiEdit (edits[].new_string)
content=$(echo "$input" | jq -r '[.tool_input.content, .tool_input.new_string, (.tool_input.edits[]?.new_string)] | map(select(. != null)) | join("\n")')

# Seul le code est contrôlé : la documentation (.md) peut citer la clé admin
case "$file_path" in
  *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs) ;;
  *) exit 0 ;;
esac

# Autoriser uniquement admin.ts et api/cron
if [[ "$file_path" == *"/supabase/admin.ts" ]] || [[ "$file_path" == *"/api/cron/"* ]]; then
  exit 0
fi

if echo "$content" | grep -q "SUPABASE_SERVICE_ROLE_KEY\|service_role"; then
  echo "BLOQUÉ : service_role interdit hors de src/lib/supabase/admin.ts et src/app/api/cron/ (JàngPay)." >&2
  exit 2
fi

exit 0