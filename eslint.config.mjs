import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

// Configuration ESLint (format « flat ») : règles Next.js + TypeScript.
// Lancer avec `npm run lint`.
const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  // Dossiers générés (build, preview, vérification) : jamais analysés
  { ignores: [".next/**", ".next-build/**", ".next-preview/**", "node_modules/**", "next-env.d.ts"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // Textes d'interface en français : l'apostrophe droite dans le JSX est voulue
      "react/no-unescaped-entities": "off",
      // `any` toléré là où une erreur ou une réponse Supabase n'a pas de type (signalé, non bloquant)
      "@typescript-eslint/no-explicit-any": "warn",
      // Un paramètre ou une variable préfixé par _ est ignoré exprès
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
];

export default config;
