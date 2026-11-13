import { describe, expect, it } from "vitest";
import { cleAEnvoyer, empreintePaiements, lignesPourRpc, lireCleEncaissement, lireResultatEncaissement, messageAnnulation, signatureEncaissement } from "@/lib/metier/encaissement";
import { lignesAEncaisser, situationInscription, type CalendrierEcole } from "@/lib/metier/scolarite";

describe("empreintePaiements", () => {
  it("aucun paiement : 0 ligne, 0 FCFA", () => {
    expect(empreintePaiements([])).toEqual({ nb: 0, total: 0 });
  });
  it("les annulés comptent dans le nombre mais pas dans le total", () => {
    const e = empreintePaiements([
      { montant: 20000, annule: false },
      { montant: 5000, annule: true },
      { montant: 3000, annule: false },
    ]);
    expect(e).toEqual({ nb: 3, total: 23000 });
  });
});

describe("lireCleEncaissement", () => {
  it("accepte un UUID v4", () => {
    expect(lireCleEncaissement("3f2b8c1e-5d4a-4b6f-9a7e-1c2d3e4f5a6b")).toBe("3f2b8c1e-5d4a-4b6f-9a7e-1c2d3e4f5a6b");
  });
  it("accepte les majuscules et renvoie des minuscules", () => {
    expect(lireCleEncaissement("3F2B8C1E-5D4A-4B6F-9A7E-1C2D3E4F5A6B")).toBe("3f2b8c1e-5d4a-4b6f-9a7e-1c2d3e4f5a6b");
  });
  it("refuse vide, absent, SQL et mauvais formats", () => {
    expect(lireCleEncaissement("")).toBeNull();
    expect(lireCleEncaissement(undefined)).toBeNull();
    expect(lireCleEncaissement(42)).toBeNull();
    expect(lireCleEncaissement("'; DROP TABLE paiements; --")).toBeNull();
    expect(lireCleEncaissement("3f2b8c1e-5d4a-4b6f-9a7e-1c2d3e4f5a6b' OR '1'='1")).toBeNull();
    expect(lireCleEncaissement("3f2b8c1e5d4a4b6f9a7e1c2d3e4f5a6b")).toBeNull();
  });
});

const ecole: CalendrierEcole = { mois_debut: 10, nb_mensualites: 9, jour_echeance: 5 };
const ins = {
  annee_scolaire: "2026-2027",
  frais_inscription: 30000,
  mensualite: 20000,
  mensualite_dernier_mois: null,
  reduction_mensuelle: 2000,
  statut: "active" as const,
};

describe("lignesPourRpc", () => {
  it("inscription, mensualité, tranche, article et libre : seuls les 5 champs attendus", () => {
    const lignes = lignesPourRpc([
      { type: "inscription", mois: null, article_id: null, montant: 30000, libelle: null },
      { type: "mensualite", mois: "2026-10-01", article_id: null, montant: 18000, libelle: null },
      { type: "mensualite", mois: "2027-06-01", article_id: null, montant: 4000, libelle: "Tranche 1/3 de juin 2027" },
      { type: "autre", mois: null, article_id: "a1", montant: 7000, libelle: "Tenue × 2" },
      { type: "autre", mois: null, article_id: null, montant: 1500, libelle: "Sortie" },
    ]);
    expect(lignes).toHaveLength(5);
    for (const l of lignes) expect(Object.keys(l).sort()).toEqual(["article_id", "libelle", "mois", "montant", "type"]);
    expect(lignes[2]).toEqual({ type: "mensualite", mois: "2027-06-01", article_id: null, montant: 4000, libelle: "Tranche 1/3 de juin 2027" });
    expect(lignes[3].article_id).toBe("a1");
    expect(lignes[4].article_id).toBeNull();
  });
  it("ne garde pas un champ ajouté par erreur", () => {
    const l = lignesPourRpc([{ type: "inscription", mois: null, article_id: null, montant: 1, libelle: null, lot_id: "x" } as any]);
    expect(l[0]).not.toHaveProperty("lot_id");
  });
});

describe("cas chiffré : mensualité 20 000, réduction 2 000", () => {
  const paiements = (liste: number[]) => liste.map((montant) => ({ type: "mensualite" as const, mois: "2026-10-01", montant, annule: false }));

  it("deux versements de 5 000 : 10 000 payés, reste 8 000", () => {
    const s = situationInscription(ins, paiements([5000, 5000]), ecole, "2026-10-10");
    const octobre = s.mois[0];
    expect(octobre.du).toBe(18000);
    expect(octobre.paye).toBe(10000);
    expect(octobre.reste).toBe(8000);
    expect(empreintePaiements(paiements([5000, 5000]).map((p) => ({ montant: p.montant, annule: p.annule })))).toEqual({ nb: 2, total: 10000 });
  });

  it("l'encaissement du reste produit une seule ligne de 8 000 pour la base", () => {
    const s = situationInscription(ins, paiements([5000, 5000]), ecole, "2026-10-10");
    const calcul = lignesAEncaisser(s, { mois: ["2026-10-01"] });
    if ("erreur" in calcul) throw new Error(calcul.erreur);
    const rpc = lignesPourRpc(calcul.lignes);
    expect(rpc).toHaveLength(1);
    expect(rpc[0]).toMatchObject({ type: "mensualite", mois: "2026-10-01", montant: 8000 });
  });
});

describe("lireResultatEncaissement", () => {
  it("lit le retour de la base", () => {
    expect(lireResultatEncaissement({ numero_recu: "FJ-2026-00001", montant_encaisse: 8000, ids: ["a", "b"], rejoue: true })).toEqual({
      numero_recu: "FJ-2026-00001",
      montant_encaisse: 8000,
      ids: ["a", "b"],
      rejoue: true,
    });
  });
  it("refuse une forme inattendue", () => {
    expect(lireResultatEncaissement(null)).toBeNull();
    expect(lireResultatEncaissement({ ids: "x" })).toBeNull();
  });
});

describe("cleAEnvoyer", () => {
  const generer = () => "nouvelle";
  const sig = signatureEncaissement({ mois: ["2027-03-01"], mode: "especes" });

  it("premier envoi : la clé du formulaire", () => {
    expect(cleAEnvoyer("k1", null, sig, generer)).toBe("k1");
  });
  it("double clic après une erreur réseau : même clé, même contenu", () => {
    expect(cleAEnvoyer("k1", { signature: sig, issue: "echec_reseau" }, sig, generer)).toBe("k1");
  });
  it("erreur réseau puis sélection modifiée : même clé conservée (le premier envoi a pu passer)", () => {
    const autre = signatureEncaissement({ mois: ["2027-04-01"], mode: "especes" });
    expect(cleAEnvoyer("k1", { signature: sig, issue: "echec_reseau" }, autre, generer)).toBe("k1");
  });
  it("succès : nouvelle clé pour l'encaissement suivant", () => {
    expect(cleAEnvoyer("k1", { signature: sig, issue: "succes" }, sig, generer)).toBe("nouvelle");
  });
  it("succès (rejeu compris) puis autre sélection : nouvelle clé", () => {
    const autre = signatureEncaissement({ mois: ["2027-04-01"], mode: "wave" });
    expect(cleAEnvoyer("k1", { signature: sig, issue: "succes" }, autre, generer)).toBe("nouvelle");
  });
  it("refus métier, même contenu : même clé", () => {
    expect(cleAEnvoyer("k1", { signature: sig, issue: "echec_metier" }, sig, generer)).toBe("k1");
  });
  it("refus métier puis changement de mois, mode, référence ou montant : nouvelle clé", () => {
    for (const autre of [
      { mois: ["2027-04-01"], mode: "especes" },
      { mois: ["2027-03-01"], mode: "wave" },
      { mois: ["2027-03-01"], mode: "especes", reference: "T123" },
      { mois: ["2027-03-01"], mode: "especes", montant: "5000" },
    ]) {
      expect(cleAEnvoyer("k1", { signature: sig, issue: "echec_metier" }, signatureEncaissement(autre), generer)).toBe("nouvelle");
    }
  });
});

describe("signatureEncaissement", () => {
  it("identique pour un même contenu, différente dès qu'un champ change", () => {
    expect(signatureEncaissement({ a: 1, b: "x" })).toBe(signatureEncaissement({ a: 1, b: "x" }));
    expect(signatureEncaissement({ a: 1, b: "x" })).not.toBe(signatureEncaissement({ a: 1, b: "y" }));
  });
});

describe("messageAnnulation", () => {
  it("0 ligne annulée : message honnête, pas un succès", () => {
    expect(messageAnnulation(0)).toEqual({ success: false, message: "Ce reçu est déjà annulé." });
  });
  it("une ou plusieurs lignes annulées : succès", () => {
    expect(messageAnnulation(1).success).toBe(true);
    expect(messageAnnulation(3).success).toBe(true);
  });
});
