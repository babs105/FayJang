import { describe, expect, it } from "vitest";
import { lienWhatsApp, messageRelance } from "@/lib/metier/whatsapp";

const base = { ecole: "École Test", parent: "Mme Diop", eleve: "Fatou", lienParent: "https://fayjang.vercel.app/parent/abc" };
// formatFCFA utilise une espace insécable : on compare sans tenir compte du type d'espace
const net = (t: string) => t.replace(/[  ]/g, " ");

describe("messageRelance", () => {
  it("élève inscrit : reste à payer et mois en retard", () => {
    const m = net(messageRelance({ ...base, arriere: 40000, moisEnRetard: 2 }));
    expect(m).toContain("présente un reste à payer de 40 000 F CFA (2 mois en retard).");
    expect(m).not.toContain("départ");
  });

  it("élève parti (exemple de référence) : solde de 60 000 dû jusqu'au départ", () => {
    const m = net(messageRelance({ ...base, arriere: 60000, moisEnRetard: 3, dateDepart: "2027-01-15" }));
    expect(m).toContain("présente un solde de 60 000 F CFA, dû jusqu'à son départ le 15 janv. 2027 (3 mois en retard).");
    expect(m).toContain(base.lienParent);
  });

  it("date de départ vide : message normal", () => {
    expect(net(messageRelance({ ...base, arriere: 20000, moisEnRetard: 0, dateDepart: null }))).toContain(
      "présente un reste à payer de 20 000 F CFA."
    );
  });

  it("lien wa.me : chiffres seuls et message encodé", () => {
    expect(lienWhatsApp("+221 77 000 00 01", "Bonjour à vous")).toBe("https://wa.me/221770000001?text=Bonjour%20%C3%A0%20vous");
  });
});
