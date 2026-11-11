import { describe, expect, it } from "vitest";
import { estEncaissementDeCaisse, totauxCaisse } from "./caisse";
import { ENCAISSE_PAR_REPRISE } from "./reprise-recu";

const p = (montant: number, paye_le: string, extra: Partial<{ annule: boolean; mode: string; encaisse_par: string | null }> = {}) => ({
  montant,
  paye_le,
  annule: false,
  mode: "especes",
  encaisse_par: null,
  ...extra,
});

describe("totauxCaisse", () => {
  it("compte la reprise dans l'année, jamais dans le jour, le mois ou les modes", () => {
    const t = totauxCaisse(
      [
        p(10000, "2026-11-11"),
        p(5000, "2026-11-03", { mode: "wave" }),
        p(76000, "2026-11-11", { encaisse_par: ENCAISSE_PAR_REPRISE }),
        p(81000, "2026-11-11", { encaisse_par: ENCAISSE_PAR_REPRISE, mode: "virement" }),
        p(20000, "2026-10-15"),
        p(9999, "2026-11-11", { annule: true }),
      ],
      "2026-11-11"
    );
    expect(t.jour).toBe(10000);
    expect(t.mois).toBe(15000);
    expect(Object.fromEntries(t.parModeMois)).toEqual({ especes: 10000, wave: 5000 });
    expect(t.reprise).toBe(157000);
    expect(t.annee).toBe(10000 + 5000 + 157000 + 20000);
  });

  it("un reçu de reprise ou annulé n'est pas un encaissement de caisse", () => {
    expect(estEncaissementDeCaisse({ annule: false, encaisse_par: null })).toBe(true);
    expect(estEncaissementDeCaisse({ annule: false, encaisse_par: ENCAISSE_PAR_REPRISE })).toBe(false);
    expect(estEncaissementDeCaisse({ annule: true, encaisse_par: null })).toBe(false);
  });
});
