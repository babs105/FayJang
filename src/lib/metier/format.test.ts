import { describe, expect, it } from "vitest";
import { fcfa } from "@/lib/metier/format";

describe("fcfa", () => {
  it("sépare les milliers et ajoute l'unité", () => {
    expect(fcfa(25000).replace(/\s/g, " ")).toBe("25 000 FCFA");
    expect(fcfa(0)).toBe("0 FCFA");
  });
});
