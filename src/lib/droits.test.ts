import { describe, expect, it } from "vitest";
import { peutFaire, type Droit } from "./droits";

const RESERVES: Droit[] = ["annuler", "classes", "parametres", "importer", "exporter", "utilisateurs"];

describe("peutFaire", () => {
  it("le directeur peut tout", () => {
    for (const d of RESERVES) expect(peutFaire("directeur", d)).toBe(true);
  });

  it("le caissier ne peut rien de réservé : annuler, classes, paramètres, import, export, comptes", () => {
    for (const d of RESERVES) expect(peutFaire("caissier", d)).toBe(false);
  });
});
