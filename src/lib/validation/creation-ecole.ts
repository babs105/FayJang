// Création d'une école : règles de saisie partagées (pur, sans Next ni Supabase).
import { normaliserTelephone } from "@/lib/validation/telephone";
import { erreurMotDePasse, normaliserEmail } from "@/lib/securite/mot-de-passe";

/** Identifiant de connexion lisible : « Cours Sainte-Marie de Hann » → « cours-sainte-marie-de-hann » */
export function slugifier(nom: string): string {
  return (
    nom
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "ecole"
  );
}

export type SaisieEcole = { nom: unknown; ville?: unknown; responsable: unknown; email: unknown; telephone: unknown; code: unknown };
export type EcoleValidee = { nom: string; ville: string | null; responsable: string; email: string; telephone: string; code: string };

/** Valeurs nettoyées, ou le message à afficher (mêmes contrôles et messages que /inscription) */
export function validerCreationEcole(saisie: SaisieEcole): { ok: true; valeurs: EcoleValidee } | { ok: false; message: string } {
  const nom = String(saisie.nom ?? "").trim().slice(0, 100);
  const ville = String(saisie.ville ?? "").trim().slice(0, 60);
  const responsable = String(saisie.responsable ?? "").trim().slice(0, 80);
  const telephone = normaliserTelephone(String(saisie.telephone ?? ""));
  const code = String(saisie.code ?? "");

  if (nom.length < 3) return { ok: false, message: "Indiquez le nom de l'école." };
  if (!responsable) return { ok: false, message: "Indiquez le nom du responsable." };
  const email = normaliserEmail(saisie.email);
  if (!email) return { ok: false, message: "Adresse e-mail invalide." };
  if (!telephone || !/^\+\d{9,15}$/.test(telephone)) return { ok: false, message: "Numéro de téléphone invalide (ex : 77 123 45 67)." };
  const refus = erreurMotDePasse(code);
  if (refus) return { ok: false, message: refus };

  return { ok: true, valeurs: { nom, ville: ville || null, responsable, email, telephone, code } };
}
