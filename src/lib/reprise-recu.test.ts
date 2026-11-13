import { describe, expect, it } from "vitest";
import { ENCAISSE_PAR_REPRISE, estRecuDeReprise, nomUtilisateurReserve } from "./reprise-recu";

describe("estRecuDeReprise", () => {
  it("reconnaît la valeur écrite par importer_reprise", () => {
    expect(ENCAISSE_PAR_REPRISE).toBe("Reprise de l'existant");
    expect(estRecuDeReprise("Reprise de l'existant")).toBe(true);
  });
  it("refuse null, vide, autre valeur ou apostrophe typographique", () => {
    expect(estRecuDeReprise(null)).toBe(false);
    expect(estRecuDeReprise(undefined)).toBe(false);
    expect(estRecuDeReprise("")).toBe(false);
    expect(estRecuDeReprise("Caisse")).toBe(false);
    expect(estRecuDeReprise("Reprise de l’existant")).toBe(false);
  });
});

describe("estRecuDeReprise avec un nom d'utilisateur", () => {
  it("un nom d'utilisateur n'est jamais une reprise", () => {
    expect(estRecuDeReprise("Moussa")).toBe(false);
  });
});

describe("nomUtilisateurReserve", () => {
  it("refuse le marqueur, quelle que soit la casse ou les espaces autour", () => {
    expect(nomUtilisateurReserve("Reprise de l'existant")).toBe(true);
    expect(nomUtilisateurReserve("reprise de l'existant")).toBe(true);
    expect(nomUtilisateurReserve("  Reprise de l'existant  ")).toBe(true);
  });
  it("refuse les variantes identiques à l'œil (apostrophe typographique, espaces doubles ou insécables)", () => {
    expect(nomUtilisateurReserve("Reprise de l’existant")).toBe(true);
    expect(nomUtilisateurReserve("Reprise  de   l'existant")).toBe(true);
    expect(nomUtilisateurReserve("Reprise\u00a0de l'existant")).toBe(true);
  });
  it("accepte un vrai nom", () => {
    expect(nomUtilisateurReserve("Moussa")).toBe(false);
    expect(nomUtilisateurReserve("Reprise")).toBe(false);
    expect(nomUtilisateurReserve(null)).toBe(false);
  });
});
