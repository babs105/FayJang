import { describe, expect, it } from "vitest";
import { matriculeSuivant } from "./matricule";

describe("matriculeSuivant", () => {
  it("premier élève de l'année", () => expect(matriculeSuivant("26", [])).toBe("260001"));
  it("après la suppression d'un élève (bug du 2026-11-08) : pas de matricule déjà pris", () =>
    expect(matriculeSuivant("26", ["260002"])).toBe("260003"));
  it("suit le plus grand, même avec un trou", () => expect(matriculeSuivant("26", ["260001", "260003"])).toBe("260004"));
  it("ignore les autres années", () => expect(matriculeSuivant("26", ["250099", "260005"])).toBe("260006"));
  it("ignore les valeurs vides ou non numériques", () => expect(matriculeSuivant("26", [null, undefined, "26abc", "260010"])).toBe("260011"));
  it("au-delà de 9 999 élèves, reste unique", () => expect(matriculeSuivant("26", ["269999"])).toBe("2610000"));
});
