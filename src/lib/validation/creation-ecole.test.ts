import { describe, expect, it } from "vitest";
import { slugifier, validerCreationEcole } from "@/lib/validation/creation-ecole";

const ok = { nom: "Cours Sainte-Marie", ville: "Dakar", responsable: "Awa Diop", email: "Awa@Ecole.sn", telephone: "77 123 45 67", code: "motdepasse1" };

describe("slugifier", () => {
  it("retire accents et ponctuation", () => {
    expect(slugifier("Cours Sainte-Marie de Hann")).toBe("cours-sainte-marie-de-hann");
    expect(slugifier("  École de l'Éveil !! ")).toBe("ecole-de-l-eveil");
  });
  it("coupe à 40 caractères", () => {
    expect(slugifier("a".repeat(60))).toHaveLength(40);
  });
  it("se replie sur « ecole »", () => {
    expect(slugifier("!!!")).toBe("ecole");
    expect(slugifier("")).toBe("ecole");
  });
});

describe("validerCreationEcole", () => {
  it("accepte une saisie complète et la nettoie", () => {
    const r = validerCreationEcole(ok);
    expect(r).toEqual({
      ok: true,
      valeurs: { nom: "Cours Sainte-Marie", ville: "Dakar", responsable: "Awa Diop", email: "awa@ecole.sn", telephone: "+221771234567", code: "motdepasse1" },
    });
  });
  it("la ville est facultative", () => {
    const r = validerCreationEcole({ ...ok, ville: "  " });
    expect(r.ok && r.valeurs.ville).toBeNull();
  });
  it("refuse un nom trop court", () => {
    expect(validerCreationEcole({ ...ok, nom: "ab" })).toEqual({ ok: false, message: "Indiquez le nom de l'école." });
  });
  it("refuse sans responsable", () => {
    expect(validerCreationEcole({ ...ok, responsable: " " })).toEqual({ ok: false, message: "Indiquez le nom du responsable." });
  });
  it("refuse un e-mail invalide ou trop long", () => {
    expect(validerCreationEcole({ ...ok, email: "pas-un-mail" })).toEqual({ ok: false, message: "Adresse e-mail invalide." });
    expect(validerCreationEcole({ ...ok, email: `${"a".repeat(120)}@x.sn` })).toEqual({ ok: false, message: "Adresse e-mail invalide." });
  });
  it("refuse un téléphone invalide", () => {
    expect(validerCreationEcole({ ...ok, telephone: "" }).ok).toBe(false);
    expect(validerCreationEcole({ ...ok, telephone: "123" }).ok).toBe(false);
  });
  it("refuse un mot de passe trop court", () => {
    const r = validerCreationEcole({ ...ok, code: "1234567" });
    expect(!r.ok && r.message).toMatch(/au moins 8/);
  });
});
