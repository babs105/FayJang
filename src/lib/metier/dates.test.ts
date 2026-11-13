import { describe, expect, it } from "vitest";
import { formatMois, formatPeriode, isDateValide } from "@/lib/metier/dates";

describe("formatPeriode", () => {
  it("affiche un service en cours, d'un seul mois ou sur plusieurs mois", () => {
    expect(formatPeriode({ debut: "2026-11-01", fin: null })).toBe("dès novembre 2026");
    expect(formatPeriode({ debut: "2026-10-01", fin: "2026-10-01" })).toBe("en octobre 2026");
    expect(formatPeriode({ debut: "2026-11-01", fin: "2027-01-01" })).toBe("de novembre 2026 à janvier 2027");
    expect(formatPeriode({ debut: null, fin: null })).toBe("");
  });
});

describe("isDateValide", () => {
  it("accepte une date réelle au format AAAA-MM-JJ", () => {
    expect(isDateValide("2026-02-28")).toBe(true);
    expect(isDateValide("2028-02-29")).toBe(true);
    expect(isDateValide("2026-12-31")).toBe(true);
  });

  it("refuse une date inexistante, mal formée ou vide", () => {
    expect(isDateValide("2026-02-31")).toBe(false);
    expect(isDateValide("2026-02-29")).toBe(false);
    expect(isDateValide("2026-04-31")).toBe(false);
    expect(isDateValide("2026-13-01")).toBe(false);
    expect(isDateValide("2026-00-10")).toBe(false);
    expect(isDateValide("31/02/2026")).toBe(false);
    expect(isDateValide("")).toBe(false);
    expect(isDateValide(null)).toBe(false);
    expect(isDateValide(undefined)).toBe(false);
  });
});

describe("formatMois", () => {
  it("écrit le mois en toutes lettres avec l'année", () => {
    expect(formatMois("2026-10-01")).toBe("octobre 2026");
    expect(formatMois("2027-01-01")).toBe("janvier 2027");
  });
});
