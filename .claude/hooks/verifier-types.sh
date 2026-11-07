#!/bin/bash
# Hook Stop : lance la vérification TypeScript en fin de tour si des fichiers .ts/.tsx ont changé.
# Code 2 = Claude reçoit les erreurs et doit les corriger avant de terminer.
entree=$(cat)

# Évite une boucle : si Claude est déjà en train de corriger après ce hook, on ne relance pas.
if [ "$(printf '%s' "$entree" | jq -r '.stop_hook_active // false')" = "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

modifies=$( { git diff --name-only HEAD; git ls-files --others --exclude-standard; } 2>/dev/null | grep -E '\.(ts|tsx)$' )
[ -z "$modifies" ] && exit 0

if ! sortie=$(npx tsc --noEmit 2>&1); then
  echo "Vérification TypeScript (npx tsc --noEmit) en échec, à corriger :" >&2
  printf '%s\n' "$sortie" | head -40 >&2
  exit 2
fi
exit 0
