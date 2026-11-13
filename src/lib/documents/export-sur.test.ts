import { describe, expect, it } from "vitest";
import { celluleTexte } from "@/lib/documents/export-sur";

describe("celluleTexte", () => {
  it("neutralise ce qu'un tableur prendrait pour une formule", () => {
    expect(celluleTexte("=HYPERLINK(\"http://x\")")).toBe("'=HYPERLINK(\"http://x\")");
    expect(celluleTexte("+33 rue")).toBe("'+33 rue");
    expect(celluleTexte("-2+3+cmd|' /C calc'!A0")).toBe("'-2+3+cmd|' /C calc'!A0");
    expect(celluleTexte("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(celluleTexte("\t=1+1")).toBe("'\t=1+1");
  });

  it("laisse intacts le texte ordinaire, les téléphones et les valeurs vides", () => {
    expect(celluleTexte("Awa Diop")).toBe("Awa Diop");
    expect(celluleTexte("Mensualité de octobre 2026")).toBe("Mensualité de octobre 2026");
    expect(celluleTexte("+221771234567")).toBe("+221771234567");
    expect(celluleTexte(null)).toBe("");
    expect(celluleTexte(undefined)).toBe("");
  });
});
