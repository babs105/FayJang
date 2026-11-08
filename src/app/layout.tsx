import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FayJàng — Suivi de la scolarité des écoles privées",
  description: "Inscriptions, mensualités, paiements Wave / Orange Money et reçus pour les écoles privées du Sénégal.",
  manifest: "/manifest.json",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#059669",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className="min-h-screen bg-background antialiased selection:bg-jang-100 selection:text-jang-700">{children}</body>
    </html>
  );
}
