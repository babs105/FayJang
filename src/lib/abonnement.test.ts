import { describe, expect, it } from "vitest";
import { lireSituationAbonnement, peutEcrire } from "./abonnement";

// La règle des dates est dans la base (situation_abonnement, bloc v1.20) : ici, seule la lecture de sa réponse
describe("lireSituationAbonnement", () => {
  it("lit la réponse de la base", () => {
    expect(lireSituationAbonnement({ etat: "alerte", fin: "2026-12-12", fin_grace: "2026-12-19", jours_restants: 7 })).toEqual({
      etat: "alerte",
      fin: "2026-12-12",
      finGrace: "2026-12-19",
      joursRestants: 7,
    });
    expect(lireSituationAbonnement({ etat: "grace", fin: "2027-01-31", fin_grace: "2027-02-07", jours_restants: -1 })?.joursRestants).toBe(-1);
  });

  it("accepte l'absence de date (suspendu, expiré, ou sans date de fin)", () => {
    expect(lireSituationAbonnement({ etat: "lecture_seule", fin: null, fin_grace: null, jours_restants: null })).toEqual({
      etat: "lecture_seule",
      fin: null,
      finGrace: null,
      joursRestants: null,
    });
    expect(lireSituationAbonnement({ etat: "normal" })?.fin).toBeNull();
  });

  it("refuse une réponse absente ou un état inconnu", () => {
    expect(lireSituationAbonnement(null)).toBeNull();
    expect(lireSituationAbonnement("normal")).toBeNull();
    expect(lireSituationAbonnement({ fin: "2026-12-12" })).toBeNull();
    expect(lireSituationAbonnement({ etat: "bloque" })).toBeNull();
  });

  it("écarte une date ou un nombre mal formés sans changer l'état", () => {
    expect(lireSituationAbonnement({ etat: "alerte", fin: "12/12/2026", fin_grace: 5, jours_restants: "7" })).toEqual({
      etat: "alerte",
      fin: null,
      finGrace: null,
      joursRestants: null,
    });
  });
});

describe("peutEcrire", () => {
  it("refuse seulement la lecture seule", () => {
    expect(peutEcrire("normal")).toBe(true);
    expect(peutEcrire("alerte")).toBe(true);
    expect(peutEcrire("grace")).toBe(true);
    expect(peutEcrire("lecture_seule")).toBe(false);
  });
});
