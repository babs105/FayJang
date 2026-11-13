import { getSessionEcole } from "@/lib/securite/ecole-session";
import { peutFaire } from "@/lib/securite/droits";
import { createClientEcole } from "@/lib/supabase/server";
import { todayDakar } from "@/lib/config";
import { LectureTropLongue, TAILLE_PAGE, comparer, toutLire, toutLireParIds } from "@/lib/supabase/lecture-paginee";
import { classeurEcole, TYPE_XLSX } from "@/lib/documents/export-excel";

export const dynamic = "force-dynamic";

/** Export Excel de l'année : journal des paiements + état des soldes par élève */
export async function GET() {
  const session = await getSessionEcole();
  if (!session) return new Response("Session expirée", { status: 401 });
  // D09 : l'export complet (élèves, téléphones des parents, paiements) est réservé au directeur
  if (!peutFaire(session.role, "exporter")) return new Response("Réservé au directeur de l'école", { status: 403 });
  const { ecoleId } = session;
  const supabase = createClientEcole(session);
  const aujourdhui = todayDakar();

  const { data: ecole } = await supabase
    .from("ecoles")
    .select("nom, slug, annee_scolaire, mois_debut, nb_mensualites, jour_echeance, tranches_dernier_mois, mois_debut_tranches, nb_tranches, rang_mois_tranches, premier_mois_a_linscription, dernier_mois_a_linscription")
    .eq("id", ecoleId)
    .maybeSingle();
  if (!ecole) return new Response("École introuvable", { status: 404 });

  // Lectures paginées (1000 lignes au plus par appel) ; paiements et articles par paquets d'inscriptions
  let inscriptions, eleves, classes, parents, paiements, articles;
  try {
    [inscriptions, eleves, classes, parents] = await Promise.all([
      toutLire((apres) =>
        supabase
          .from("inscriptions")
          .select("id, eleve_id, classe_id, annee_scolaire, frais_inscription, mensualite, mensualite_dernier_mois, reduction_mensuelle, statut, date_depart")
          .eq("ecole_id", ecoleId)
          .eq("annee_scolaire", ecole.annee_scolaire)
          .gt("id", apres)
          .order("id")
          .limit(TAILLE_PAGE)
      ),
      toutLire((apres) => supabase.from("eleves").select("id, matricule, prenom, nom, parent_id").eq("ecole_id", ecoleId)
          .gt("id", apres)
          .order("id")
          .limit(TAILLE_PAGE)),
      toutLire((apres) => supabase.from("classes").select("id, nom").eq("ecole_id", ecoleId)
          .gt("id", apres)
          .order("id")
          .limit(TAILLE_PAGE)),
      toutLire((apres) => supabase.from("parents").select("id, nom, telephone").eq("ecole_id", ecoleId)
          .gt("id", apres)
          .order("id")
          .limit(TAILLE_PAGE)),
    ]);
    const ids = inscriptions.map((i) => i.id);
    [paiements, articles] = await Promise.all([
      toutLireParIds(ids, (paquet, apres) =>
        supabase
          .from("paiements")
          .select("id, inscription_id, numero_recu, type, mois, montant, mode, reference, libelle, paye_le, annule, motif_annulation, article_id, encaisse_par")
          .eq("ecole_id", ecoleId)
          .in("inscription_id", paquet)
          .gt("id", apres)
          .order("id")
          .limit(TAILLE_PAGE)
      ),
      toutLireParIds(ids, (paquet, apres) =>
        supabase
          .from("articles_inscription")
          .select("id, inscription_id, libelle, nature, prix_unitaire, quantite, obligatoire, mois_debut, mois_fin")
          .eq("ecole_id", ecoleId)
          .in("inscription_id", paquet)
          .gt("id", apres)
          .order("id")
          .limit(TAILLE_PAGE)
      ),
    ]);
  } catch (err) {
    console.error("[ecole/export] lecture des données :", err instanceof LectureTropLongue ? "trop de lignes" : ((err as { code?: string })?.code ?? "erreur"));
    return new Response("Export impossible pour le moment, réessayez.", { status: 500 });
  }
  // Journal dans l'ordre des dates (la lecture par paquets ne garde pas d'ordre global)
  paiements.sort((x, y) => comparer(`${x.paye_le}|${x.numero_recu ?? ""}`, `${y.paye_le}|${y.numero_recu ?? ""}`, x.id, y.id));

  const tampon = await classeurEcole({
    ecole,
    aujourdhui,
    inscriptions: inscriptions ?? [],
    eleves: eleves ?? [],
    classes: classes ?? [],
    parents: parents ?? [],
    paiements: paiements ?? [],
    articles: articles ?? [],
  });
  return new Response(tampon, {
    headers: {
      "Content-Type": TYPE_XLSX,
      "Content-Disposition": `attachment; filename="fayjang-${ecole.slug}-${ecole.annee_scolaire}.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
