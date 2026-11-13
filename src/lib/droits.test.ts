import { describe, expect, it } from "vitest";
import { peutFaire } from "./droits";

describe("peutFaire", () => {
  it("le caissier ne peut pas annuler un reçu", () => expect(peutFaire("caissier", "annuler")).toBe(false));
  it("le directeur peut annuler un reçu", () => expect(peutFaire("directeur", "annuler")).toBe(true));
});
