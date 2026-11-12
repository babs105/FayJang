// Lecture complète d'une table malgré la limite de PostgREST (1000 lignes au plus par appel).
// Sans pagination, une école de plus de 1000 élèves ou paiements verrait des listes et des soldes incomplets, sans erreur.
//
// Pagination par curseur sur l'id (« les lignes après tel id ») et non par rang (`range`) : une écriture pendant la
// lecture (un paiement encaissé depuis un autre poste) ne peut ni dupliquer une ligne ni en faire sauter une.

export const TAILLE_PAGE = 1000;
/** Identifiants par appel `.in(...)` : 2000 UUID ne tiennent pas dans une URL */
export const TAILLE_PAQUET_IDS = 150;
/** Au-delà, on refuse plutôt que de charger une école entière en mémoire */
export const MAX_LIGNES = 50_000;
/** Plus petit UUID : `.gt("id", PREMIER_ID)` part du début */
export const PREMIER_ID = "00000000-0000-0000-0000-000000000000";

/** Trop de lignes pour une lecture complète : on refuse plutôt que d'afficher une liste tronquée */
export class LectureTropLongue extends Error {}

/**
 * La requête reçoit le dernier id lu et doit renvoyer `.gt("id", apresId).order("id").limit(TAILLE_PAGE)`.
 * L'ordre d'affichage est à refaire en mémoire par l'appelant.
 */
type Requete<T> = (apresId: string) => PromiseLike<{ data: T[] | null; error: unknown }>;

/** Lit toutes les lignes d'une requête, page par page, au plus `maxLignes` (sinon `LectureTropLongue`) */
export async function toutLire<T extends { id: string }>(requete: Requete<T>, maxLignes = MAX_LIGNES): Promise<T[]> {
  const tout: T[] = [];
  let apres = PREMIER_ID;
  for (;;) {
    const { data, error } = await requete(apres);
    if (error) throw error;
    const lignes = data ?? [];
    tout.push(...lignes);
    if (tout.length > maxLignes) throw new LectureTropLongue(`Plus de ${maxLignes} lignes à lire.`);
    if (lignes.length < TAILLE_PAGE) return tout;
    apres = lignes[lignes.length - 1].id;
  }
}

/** Découpe une liste d'identifiants en paquets de `taille` */
export function paquets<T>(ids: T[], taille = TAILLE_PAQUET_IDS): T[][] {
  const res: T[][] = [];
  for (let i = 0; i < ids.length; i += taille) res.push(ids.slice(i, i + taille));
  return res;
}

/**
 * Lit toutes les lignes liées à une liste d'identifiants : un `.in(...)` par paquet, chaque paquet lu par curseur.
 * Les paquets sont lus l'un après l'autre (pas de rafale d'appels) ; le plafond porte sur le total des lignes.
 */
export async function toutLireParIds<T extends { id: string }>(
  ids: string[],
  requete: (paquet: string[], apresId: string) => PromiseLike<{ data: T[] | null; error: unknown }>,
  maxLignes = MAX_LIGNES
): Promise<T[]> {
  const tout: T[] = [];
  for (const paquet of paquets(ids)) {
    tout.push(...(await toutLire((apres) => requete(paquet, apres), maxLignes - tout.length)));
  }
  return tout;
}

/** Ordre stable pour les tris en mémoire : compare deux chaînes, puis départage par id */
export function comparer(a: string, b: string, idA: string, idB: string): number {
  if (a !== b) return a < b ? -1 : 1;
  return idA < idB ? -1 : idA > idB ? 1 : 0;
}
