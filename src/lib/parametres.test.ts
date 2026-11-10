import { describe, expect, it } from "vitest";
import { lireResultatParametres, messageParametres } from "./parametres";

describe("lireResultatParametres", () => {
  it("lit le retour de enregistrer_parametres", () => {
    expect(lireResultatParametres({ annee_changee: true, classes_copiees: 2, articles_copies: 3, classes_deja_presentes: 0 })).toEqual({
      annee_changee: true,
      classes_copiees: 2,
      articles_copies: 3,
      classes_deja_presentes: 0,
    });
  });
  it("retour absent ou mal formé : rien de copié", () => {
    const vide = { annee_changee: false, classes_copiees: 0, articles_copies: 0, classes_deja_presentes: 0 };
    expect(lireResultatParametres(null)).toEqual(vide);
    expect(lireResultatParametres("x")).toEqual(vide);
    expect(lireResultatParametres({ annee_changee: "oui", classes_copiees: -1, articles_copies: 1.5 })).toEqual(vide);
  });
});

describe("messageParametres", () => {
  const r = (x: Partial<ReturnType<typeof lireResultatParametres>>) => ({ annee_changee: false, classes_copiees: 0, articles_copies: 0, classes_deja_presentes: 0, ...x });

  it("2 classes reprises (CM2 A et CI, 3 articles)", () => {
    expect(messageParametres(r({ annee_changee: true, classes_copiees: 2, articles_copies: 3 }), "2027-2028")).toBe(
      "Paramètres enregistrés. 2 classes reprises pour 2027-2028 : réinscrivez les élèves."
    );
  });
  it("singulier : 1 classe reprise", () => {
    expect(messageParametres(r({ annee_changee: true, classes_copiees: 1 }), "2027-2028")).toBe(
      "Paramètres enregistrés. 1 classe reprise pour 2027-2028 : réinscrivez les élèves."
    );
  });
  it("nouvelle année déjà préparée : l'école est prévenue", () => {
    expect(messageParametres(r({ annee_changee: true, classes_deja_presentes: 3 }), "2026-2027")).toBe(
      "Paramètres enregistrés. Les classes de 2026-2027 existent déjà : rien n'a été copié."
    );
  });
  it("année inchangée, ou nouvelle année sans classe à reprendre", () => {
    expect(messageParametres(r({}), "2026-2027")).toBe("Paramètres enregistrés.");
    expect(messageParametres(r({ annee_changee: true }), "2027-2028")).toBe("Paramètres enregistrés.");
  });
});
