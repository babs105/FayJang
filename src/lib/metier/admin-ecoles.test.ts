import { describe, expect, it } from "vitest";
import { ecolesEnRetard, lignesExportAdmin, rubriqueAbonnement, statsGlobales, type EcoleAdmin } from "@/lib/metier/admin-ecoles";

function ecole(champs: Partial<EcoleAdmin>): EcoleAdmin {
  return {
    id: "e",
    nom: "École",
    slug: "ecole",
    ville: null,
    responsable_nom: "Resp",
    email_contact: "a@b.sn",
    telephone_contact: "+221771234567",
    annee_scolaire: "2026-2027",
    plan: "standard",
    statut_abonnement: "actif",
    trial_ends_at: null,
    abonnement_fin: "2027-06-30",
    is_active: true,
    created_at: "2026-09-01T10:00:00Z",
    eleves: 0,
    encaisse: 0,
    abonnement: { etat: "normal", fin: "2027-06-30", finGrace: "2027-07-07", joursRestants: 200 },
    ...champs,
  } as EcoleAdmin;
}

const situation = (etat: "normal" | "alerte" | "grace" | "lecture_seule", fin: string) => ({ etat, fin, finGrace: null, joursRestants: null });

describe("statsGlobales", () => {
  it("compte les écoles par statut et additionne élèves et encaissements", () => {
    const s = statsGlobales([
      ecole({ eleves: 120, encaisse: 2_400_000 }),
      ecole({ statut_abonnement: "essai", eleves: 30, encaisse: 600_000, abonnement: situation("alerte", "2026-11-15") }),
      ecole({ statut_abonnement: "suspendu", is_active: false, abonnement: situation("lecture_seule", "2026-10-01") }),
      ecole({ abonnement: situation("grace", "2026-11-10") }),
      ecole({ abonnement: null }),
    ]);
    expect(s).toEqual({
      ecoles: 5,
      abonnees: 3,
      enEssai: 1,
      suspendues: 1,
      desactivees: 1,
      enRetard: 2,
      finProche: 1,
      eleves: 150,
      encaisse: 3_000_000,
    });
  });
});

describe("ecolesEnRetard", () => {
  it("garde la grâce et la lecture seule, la fin la plus ancienne d'abord", () => {
    const r = ecolesEnRetard([
      ecole({ id: "a", abonnement: situation("grace", "2026-11-10") }),
      ecole({ id: "b", abonnement: situation("normal", "2027-06-30") }),
      ecole({ id: "c", abonnement: situation("lecture_seule", "2026-10-01") }),
      ecole({ id: "d", abonnement: null }),
    ]);
    expect(r.map((e) => e.id)).toEqual(["c", "a"]);
  });
});

describe("rubriqueAbonnement", () => {
  it("range une école sans état lu dans « inconnu »", () => {
    expect(rubriqueAbonnement(ecole({ abonnement: null }))).toBe("inconnu");
    expect(rubriqueAbonnement(ecole({ abonnement: situation("grace", "2026-11-10") }))).toBe("grace");
  });
});

describe("lignesExportAdmin", () => {
  it("neutralise un nom qui ressemble à une formule et garde le téléphone", () => {
    const [ligne] = lignesExportAdmin([ecole({ nom: "=HYPERLINK(\"x\")", eleves: 12, encaisse: 240_000 })]);
    expect(ligne[0]).toBe("'=HYPERLINK(\"x\")");
    expect(ligne[5]).toBe("+221771234567");
    expect(ligne.slice(7, 15)).toEqual(["standard", "Actif", "Normal", "2027-06-30", "Oui", 12, 240_000, "2026-09-01"]);
  });
});
