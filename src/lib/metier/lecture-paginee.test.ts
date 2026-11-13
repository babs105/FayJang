import { describe, expect, it } from "vitest";
import { LectureTropLongue, PREMIER_ID, TAILLE_PAGE, paquets, toutLire, toutLireParIds } from "@/lib/metier/lecture-paginee";

const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

/** Table simulée : renvoie les lignes d'id > apres, triées, 1000 au plus */
function table(lignes: { id: string }[]) {
  const appels: string[] = [];
  const lire = (apres: string) => {
    appels.push(apres);
    const page = lignes.filter((l) => l.id > apres).sort((a, b) => (a.id < b.id ? -1 : 1)).slice(0, TAILLE_PAGE);
    return Promise.resolve({ data: page, error: null });
  };
  return { lire, appels };
}

describe("toutLire (pagination par curseur)", () => {
  it("lit 2500 lignes en 3 appels, sans doublon ni trou", async () => {
    const lignes = Array.from({ length: 2500 }, (_, i) => ({ id: id(i + 1) }));
    const t = table(lignes);
    const lu = await toutLire(t.lire);
    expect(lu).toHaveLength(2500);
    expect(new Set(lu.map((l) => l.id)).size).toBe(2500);
    expect(t.appels).toEqual([PREMIER_ID, id(1000), id(2000)]);
  });

  it("une ligne insérée pendant la lecture ne décale rien (pas de doublon)", async () => {
    const lignes = Array.from({ length: 1500 }, (_, i) => ({ id: id(i * 2 + 2) }));
    const t = table(lignes);
    let premier = true;
    const lu = await toutLire((apres) => {
      const r = t.lire(apres);
      // Après la première page, un paiement est encaissé avec un id placé avant le curseur
      if (premier) {
        premier = false;
        lignes.push({ id: id(1) });
      }
      return r;
    });
    expect(new Set(lu.map((l) => l.id)).size).toBe(lu.length);
    expect(lu).toHaveLength(1500);
  });

  it("refuse au-delà du plafond plutôt que de tronquer", async () => {
    const t = table(Array.from({ length: 2001 }, (_, i) => ({ id: id(i + 1) })));
    await expect(toutLire(t.lire, 2000)).rejects.toBeInstanceOf(LectureTropLongue);
  });

  it("par paquets d'identifiants : le plafond porte sur le total des lignes, pas sur le nombre de paquets", async () => {
    const ids = Array.from({ length: 8000 }, (_, i) => id(i + 1)); // 54 paquets, presque tous vides
    const lignes = [{ id: id(5), ins: id(3) }];
    const lu = await toutLireParIds(ids, (paquet) => Promise.resolve({ data: lignes.filter((l) => paquet.includes(l.ins)), error: null }), 10);
    expect(lu).toHaveLength(1);
    expect(paquets(ids)).toHaveLength(54);
  });
});
