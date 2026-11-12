import { describe, expect, it } from "vitest";
import { erreurMotDePasse, normaliserEmail } from "./mot-de-passe";

describe("erreurMotDePasse", () => {
  it("refuse 7 caractères, accepte 8", () => {
    expect(erreurMotDePasse("1234567")).toMatch(/au moins 8/);
    expect(erreurMotDePasse("12345678")).toBeNull();
  });

  it("ne compte pas les espaces autour", () => {
    expect(erreurMotDePasse("  1234567  ")).toMatch(/au moins 8/);
  });

  it("refuse plus de 100 caractères", () => {
    expect(erreurMotDePasse("a".repeat(100))).toBeNull();
    expect(erreurMotDePasse("a".repeat(101))).toMatch(/au plus 100/);
  });
});

describe("normaliserEmail", () => {
  it("met en minuscules et retire les espaces", () => {
    expect(normaliserEmail("  Direction@Ecole-LAF.sn ")).toBe("direction@ecole-laf.sn");
  });

  it("refuse un slug, un e-mail incomplet ou trop long", () => {
    expect(normaliserEmail("ecole-laf")).toBeNull();
    expect(normaliserEmail("direction@ecole")).toBeNull();
    expect(normaliserEmail("")).toBeNull();
    expect(normaliserEmail(null)).toBeNull();
    expect(normaliserEmail(`${"a".repeat(116)}@b.sn`)).toBeNull();
  });
});
