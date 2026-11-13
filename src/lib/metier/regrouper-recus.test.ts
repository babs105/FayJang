import { describe, expect, it } from "vitest";
import { regrouperParRecu, resumeRecu } from "@/lib/metier/regrouper-recus";
import type { LigneRecu } from "@/types/metier";

let n = 0;
function ligne(p: Partial<LigneRecu> = {}): LigneRecu {
  n += 1;
  return {
    id: `p${n}`,
    inscription_id: "ins-A",
    lot_id: "lot-1",
    numero_recu: "FJ-2026-00001",
    type: "mensualite",
    mois: "2026-10-01",
    libelle: null,
    montant: 25000,
    annule: false,
    motif_annulation: null,
    ...p,
  };
}

describe("regrouperParRecu", () => {
  it("3 mensualités d'un même lot = 1 reçu de 75 000", () => {
    const recus = regrouperParRecu([
      ligne({ mois: "2026-10-01" }),
      ligne({ mois: "2026-11-01" }),
      ligne({ mois: "2026-12-01" }),
    ]);
    expect(recus).toHaveLength(1);
    expect(recus[0].total).toBe(75000);
    expect(recus[0].lignes).toHaveLength(3);
    expect(recus[0].annule).toBe(false);
  });

  it("lignes sans lot_id (avant v1.4) : un reçu par ligne", () => {
    const recus = regrouperParRecu([ligne({ lot_id: null }), ligne({ lot_id: null })]);
    expect(recus).toHaveLength(2);
  });

  it("reçu annulé : reste visible, total 0, total brut conservé, motif repris", () => {
    const recus = regrouperParRecu([
      ligne({ annule: true, motif_annulation: "Erreur de saisie" }),
      ligne({ annule: true, motif_annulation: "Erreur de saisie" }),
    ]);
    expect(recus).toHaveLength(1);
    expect(recus[0].annule).toBe(true);
    expect(recus[0].total).toBe(0);
    expect(recus[0].totalBrut).toBe(50000);
    expect(recus[0].motif_annulation).toBe("Erreur de saisie");
  });

  it("lot partiellement annulé (cas défensif) : non annulé, total = lignes valides", () => {
    const [recu] = regrouperParRecu([ligne({ montant: 25000 }), ligne({ montant: 10000, annule: true })]);
    expect(recu.annule).toBe(false);
    expect(recu.total).toBe(25000);
    expect(recu.totalBrut).toBe(35000);
  });

  it("même lot_id sur deux inscriptions différentes : deux reçus", () => {
    const recus = regrouperParRecu([ligne({ inscription_id: "ins-A" }), ligne({ inscription_id: "ins-B" })]);
    expect(recus).toHaveLength(2);
  });

  it("garde l'ordre d'arrivée des reçus", () => {
    const recus = regrouperParRecu([ligne({ lot_id: "B" }), ligne({ lot_id: "A" }), ligne({ lot_id: "B" })]);
    expect(recus.map((r) => r.premiere.lot_id)).toEqual(["B", "A"]);
  });

  it("invariant argent : somme des reçus = somme des lignes non annulées", () => {
    const lignes = [
      ligne({ lot_id: "1", montant: 30000, type: "inscription", mois: null }),
      ligne({ lot_id: "1", montant: 25000 }),
      ligne({ lot_id: "2", montant: 25000, annule: true }),
      ligne({ lot_id: null, montant: 5000 }),
      ligne({ lot_id: "3", montant: 12500, inscription_id: "ins-B" }),
    ];
    const recus = regrouperParRecu(lignes);
    const sommeLignes = lignes.filter((l) => !l.annule).reduce((s, l) => s + l.montant, 0);
    expect(recus.reduce((s, r) => s + r.total, 0)).toBe(sommeLignes);
    expect(sommeLignes).toBe(72500);
    expect(recus).toHaveLength(4);
  });
});

describe("resumeRecu", () => {
  it("une seule ligne : son libellé", () => {
    expect(resumeRecu([ligne({ mois: "2026-10-01" })])).toBe("Mensualité de octobre 2026");
  });

  it("plusieurs mensualités : nombre et plage de mois", () => {
    expect(resumeRecu([ligne({ mois: "2026-12-01" }), ligne({ mois: "2026-10-01" }), ligne({ mois: "2026-11-01" })])).toBe(
      "3 mensualités (oct.–déc.)"
    );
  });

  it("inscription + 1re mensualité", () => {
    expect(resumeRecu([ligne({ type: "inscription", mois: null }), ligne({ mois: "2026-10-01" })])).toBe(
      "Frais d'inscription + 1 mensualité (oct.)"
    );
  });

  it("au-delà de deux autres frais : les deux premiers puis le reste compté", () => {
    expect(
      resumeRecu([
        ligne({ type: "autre", mois: null, libelle: "Tenue" }),
        ligne({ type: "autre", mois: null, libelle: "Blouson" }),
        ligne({ type: "autre", mois: null, libelle: "Fournitures" }),
        ligne({ type: "autre", mois: null, libelle: "Badge" }),
      ])
    ).toBe("Badge + Blouson + 2 autre(s) frais");
  });

  it("ordre stable quel que soit l'ordre des lignes : inscription d'abord, puis alphabétique", () => {
    const a = ligne({ type: "autre", mois: null, libelle: "Jacket" });
    const b = ligne({ type: "inscription", mois: null });
    const c = ligne({ type: "autre", mois: null, libelle: "Ensemble blouson" });
    expect(resumeRecu([a, b, c])).toBe("Frais d'inscription + Ensemble blouson + 1 autre(s) frais");
    expect(resumeRecu([c, a, b])).toBe("Frais d'inscription + Ensemble blouson + 1 autre(s) frais");
  });
});
