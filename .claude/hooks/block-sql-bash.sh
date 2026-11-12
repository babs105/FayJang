#!/bin/bash
# Hook PreToolUse (Bash) : une commande shell qui peut ÉCRIRE dans un fichier .sql demande l'accord de l'humain,
# comme block-sql-writes.sh le fait pour Write et Edit. Les lectures (git diff, grep, cat, sed -n) et les deux
# scripts de génération (build-schema.sh, schema-index.sh) passent sans question.
# Limite connue : une commande qui écrit un .sql sans citer « .sql » dans son texte n'est pas vue.
input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty')
[ -z "$cmd" ] && exit 0

# La commande ne cite aucun fichier .sql : rien à contrôler.
printf '%s' "$cmd" | grep -q '\.sql' || exit 0

# Redirections sans effet sur un fichier (2>&1, 2>/dev/null) retirées avant de chercher un « > ».
net=$(printf '%s' "$cmd" | sed -E 's/[0-9]*>&[0-9]+//g; s/[0-9]*>[[:space:]]*\/dev\/null//g')

ecrit='>|sed[[:space:]]+(-[a-zA-Z]*i|--in-place)|perl[[:space:]]+-[a-zA-Z]*i'
ecrit="$ecrit|(^|[^a-zA-Z_./-])(tee|cp|mv|rm|truncate|dd|patch|python|python3|node|ruby|awk)([^a-zA-Z_]|$)"
ecrit="$ecrit|git[[:space:]]+(checkout|restore|apply|stash|reset|switch|merge|pull|rebase)"

if printf '%s' "$net" | grep -Eq "$ecrit"; then
  jq -n '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: "Cette commande peut modifier un fichier SQL : vérifiez-la avant d'\''accepter. Le schéma ne change qu'\''avec votre accord (sources dans supabase/schema/, puis build-schema.sh)."
    }
  }'
fi
exit 0
