import { describe, expect, it } from "vitest";
import { derniereModification } from "@/lib/metier/modifications";

const CREATION = "2026-10-01T09:15:00.123456+00:00";

describe("derniereModification", () => {
  it("élève jamais modifié (updated_at = created_at partout) : rien à afficher", () => {
    expect(derniereModification([
      { created_at: CREATION, updated_at: CREATION },
      { created_at: CREATION, updated_at: CREATION },
    ])).toBeNull();
  });

  it("réduction modifiée le 10 nov. : la date de l'inscription est retenue", () => {
    expect(derniereModification([
      { created_at: CREATION, updated_at: CREATION },
      { created_at: CREATION, updated_at: "2026-11-10T19:39:07.71557+00:00" },
    ])).toBe("2026-11-10T19:39:07.71557+00:00");
  });

  it("parent modifié après l'arrêt d'un service : la plus récente des deux", () => {
    expect(derniereModification([
      { created_at: CREATION, updated_at: "2026-11-02T08:00:00+00:00" },
      { created_at: CREATION, updated_at: "2026-11-09T17:30:00.5+00:00" },
      null,
      undefined,
    ])).toBe("2026-11-09T17:30:00.5+00:00");
  });

  it("compare les instants, pas les chaînes (précision des décimales variable)", () => {
    expect(derniereModification([
      { created_at: CREATION, updated_at: "2026-11-10T10:00:00.9+00:00" },
      { created_at: CREATION, updated_at: "2026-11-10T10:00:00.123456+00:00" },
    ])).toBe("2026-11-10T10:00:00.9+00:00");
  });

  it("dates illisibles ou antérieures à la création : ignorées", () => {
    expect(derniereModification([
      { created_at: CREATION, updated_at: "pas une date" },
      { created_at: CREATION, updated_at: "2026-09-30T00:00:00+00:00" },
    ])).toBeNull();
  });
});
