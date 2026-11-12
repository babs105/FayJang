import type { NextConfig } from "next";

// Content-Security-Policy : tout vient du site lui-même (aucune police, image ni script externe, et le
// navigateur n'appelle jamais Supabase : seul le serveur le fait). 'unsafe-inline' reste nécessaire pour les
// scripts et styles en ligne de Next (des nonces exigeraient un middleware, que le projet n'a pas).
// En développement, le rechargement à chaud a besoin de 'unsafe-eval' et d'une connexion WebSocket.
const enDev = process.env.NODE_ENV !== "production";
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${enDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${enDev ? " ws: wss:" : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  // La preview Claude (port 3126) et les builds de vérification utilisent leur propre dossier :
  // sinon ils écrasent le .next du `npm run dev` lancé à la main
  distDir: process.env.NEXT_DIST_DIR || ".next",
  reactStrictMode: true,
  // En-têtes de sécurité sur toutes les réponses. Referrer-Policy : l'adresse de la page parent contient
  // le lien magique, elle ne doit jamais partir vers un autre site.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
  experimental: {
    // Reprise de l'existant : le fichier Excel de l'école (2 Mo au maximum) passe par une Server Action
    serverActions: { bodySizeLimit: "3mb" },
  },
};

export default nextConfig;
