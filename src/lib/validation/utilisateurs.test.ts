import { describe, expect, it } from "vitest";
import { lireSaisieCaissier } from "@/lib/validation/utilisateurs";

const ok = { nom: "Moussa Ndiaye", email: "moussa@laf.sn", motDePasse: "provisoire1" };

describe("lireSaisieCaissier", () => {
  it("accepte une saisie complète et la nettoie", () => {
    expect(lireSaisieCaissier({ nom: "  Moussa Ndiaye ", email: " Moussa@LAF.sn ", motDePasse: "provisoire1" })).toEqual(ok);
  });

  it("refuse un nom vide ou trop long", () => {
    expect(lireSaisieCaissier({ ...ok, nom: "   " })).toMatch(/nom du caissier/);
    expect(lireSaisieCaissier({ ...ok, nom: "a".repeat(101) })).toMatch(/100 caractères/);
  });

  it("refuse le nom réservé de la reprise, quelle que soit sa forme", () => {
    expect(lireSaisieCaissier({ ...ok, nom: "Reprise de l'existant" })).toMatch(/réservé/);
    expect(lireSaisieCaissier({ ...ok, nom: "reprise de l’existant" })).toMatch(/réservé/);
  });

  it("refuse un e-mail invalide", () => {
    expect(lireSaisieCaissier({ ...ok, email: "moussa" })).toMatch(/e-mail invalide/);
  });

  it("refuse un mot de passe de 7 caractères, accepte 8", () => {
    expect(lireSaisieCaissier({ ...ok, motDePasse: "1234567" })).toMatch(/au moins 8/);
    expect(lireSaisieCaissier({ ...ok, motDePasse: "12345678" })).toEqual({ ...ok, motDePasse: "12345678" });
  });
});
