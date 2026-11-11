import { describe, expect, it } from "vitest";
import { formatPeriode } from "./dates";

describe("formatPeriode", () => {
  it("affiche un service en cours, d'un seul mois ou sur plusieurs mois", () => {
    expect(formatPeriode({ debut: "2026-11-01", fin: null })).toBe("dès novembre 2026");
    expect(formatPeriode({ debut: "2026-10-01", fin: "2026-10-01" })).toBe("en octobre 2026");
    expect(formatPeriode({ debut: "2026-11-01", fin: "2027-01-01" })).toBe("de novembre 2026 à janvier 2027");
    expect(formatPeriode({ debut: null, fin: null })).toBe("");
  });
});
