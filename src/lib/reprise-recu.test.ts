import { describe, expect, it } from "vitest";
import { ENCAISSE_PAR_REPRISE, estRecuDeReprise } from "./reprise-recu";

describe("estRecuDeReprise", () => {
  it("reconnaît la valeur écrite par importer_reprise", () => {
    expect(ENCAISSE_PAR_REPRISE).toBe("Reprise de l'existant");
    expect(estRecuDeReprise("Reprise de l'existant")).toBe(true);
  });
  it("refuse null, vide, autre valeur ou apostrophe typographique", () => {
    expect(estRecuDeReprise(null)).toBe(false);
    expect(estRecuDeReprise(undefined)).toBe(false);
    expect(estRecuDeReprise("")).toBe(false);
    expect(estRecuDeReprise("Caisse")).toBe(false);
    expect(estRecuDeReprise("Reprise de l’existant")).toBe(false);
  });
});
