import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // La preview Claude (port 3126) et les builds de vérification utilisent leur propre dossier :
  // sinon ils écrasent le .next du `npm run dev` lancé à la main
  distDir: process.env.NEXT_DIST_DIR || ".next",
  reactStrictMode: true,
  experimental: {
    // Reprise de l'existant : le fichier Excel de l'école (2 Mo au maximum) passe par une Server Action
    serverActions: { bodySizeLimit: "3mb" },
  },
};

export default nextConfig;
