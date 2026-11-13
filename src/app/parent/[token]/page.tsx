import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CheckCircle2, ChevronRight, FileText, GraduationCap, Phone } from "lucide-react";
import { echangerJetonParent } from "@/lib/supabase/server";
import { todayDakar } from "@/lib/config";
import { formatDate, formatMois, formatMoisCourt } from "@/lib/metier/dates";
import { LIBELLE_MODE, libellePaiement } from "@/lib/metier/libelles";
import { estRecuDeReprise } from "@/lib/metier/reprise-recu";
import { regrouperParRecu, resumeRecu } from "@/lib/metier/regrouper-recus";
import { situationInscription, type StatutMois } from "@/lib/metier/scolarite";
import { cn, formatFCFA } from "@/lib/utils";

export const dynamic = "force-dynamic";

// Lien personnel : jamais indexé
export const metadata: Metadata = { title: "Suivi de scolarité — FayJàng", robots: { index: false, follow: false } };

const STYLE: Record<StatutMois, string> = {
  paye: "bg-jang-50 text-jang-700 border-jang-100",
  partiel: "bg-amber-50 text-amber-700 border-amber-100",
  retard: "bg-red-50 text-red-700 border-red-100",
  a_venir: "bg-white text-neutral-400 border-neutral-200",
  non_du: "bg-neutral-50 text-neutral-300 border-neutral-100",
};

/** Espace parent (lien magique) : page serveur légère, sans JavaScript client (réseau 3G) */
export default async function ParentPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const acces = await echangerJetonParent(token);
  if (!acces) notFound();
  const { supabase, ecoleId, parentId } = acces;
  const aujourdhui = todayDakar();

  const [{ data: ecole }, { data: parent }, { data: enfants }] = await Promise.all([
    supabase.from("ecoles").select("nom, ville, telephone_contact, annee_scolaire, mois_debut, nb_mensualites, jour_echeance, tranches_dernier_mois, mois_debut_tranches, nb_tranches, rang_mois_tranches, premier_mois_a_linscription, dernier_mois_a_linscription").eq("id", ecoleId).maybeSingle(),
    supabase.from("parents").select("nom").eq("id", parentId).maybeSingle(),
    supabase.from("eleves").select("id, prenom, nom, matricule").eq("ecole_id", ecoleId).eq("parent_id", parentId).eq("is_active", true).order("prenom"),
  ]);
  if (!ecole || !parent) notFound();

  const idsEnfants = (enfants ?? []).map((e) => e.id);
  const { data: inscriptions } = idsEnfants.length
    ? await supabase
        .from("inscriptions")
        .select("id, eleve_id, classe_id, annee_scolaire, frais_inscription, mensualite, mensualite_dernier_mois, reduction_mensuelle, statut, date_depart")
        .eq("ecole_id", ecoleId)
        .eq("annee_scolaire", ecole.annee_scolaire)
        .in("eleve_id", idsEnfants)
    : { data: [] };
  const idsIns = (inscriptions ?? []).map((i) => i.id);
  const [{ data: paiements }, { data: classes }, { data: articles }] = await Promise.all([
    idsIns.length
      ? supabase
          .from("paiements")
          .select("id, inscription_id, lot_id, numero_recu, type, mois, montant, mode, libelle, paye_le, annule, article_id, encaisse_par")
          .eq("ecole_id", ecoleId)
          .in("inscription_id", idsIns)
          .order("paye_le", { ascending: false })
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as never[] }),
    supabase.from("classes").select("id, nom").eq("ecole_id", ecoleId),
    idsIns.length
      ? supabase.from("articles_inscription").select("id, inscription_id, libelle, nature, prix_unitaire, quantite, obligatoire, mois_debut, mois_fin").eq("ecole_id", ecoleId).in("inscription_id", idsIns).order("created_at")
      : Promise.resolve({ data: [] as never[] }),
  ]);
  const classeNom = new Map((classes ?? []).map((c) => [c.id, c.nom]));

  return (
    <div className="min-h-screen bg-neutral-50 pb-10">
      <header className="bg-jang-600 text-white px-4 pt-6 pb-10">
        <div className="max-w-md mx-auto">
          <p className="text-[11px] uppercase tracking-wide opacity-80 flex items-center gap-1">
            <GraduationCap className="w-3.5 h-3.5" /> {ecole.nom} · {ecole.annee_scolaire}
          </p>
          <h1 className="text-lg font-extrabold mt-1">Bonjour {parent.nom}</h1>
          <p className="text-xs opacity-90">Suivi de la scolarité de vos enfants</p>
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 -mt-6 space-y-4">
        {(enfants ?? []).length === 0 && (
          <div className="bg-white rounded-3xl p-5 text-xs text-neutral-600 shadow-sm">Aucun enfant rattaché à ce lien.</div>
        )}
        {(enfants ?? []).map((enfant) => {
          const ins = (inscriptions ?? []).find((i) => i.eleve_id === enfant.id);
          const ps = (paiements ?? []).filter((p) => p.inscription_id === ins?.id);
          const s = ins ? situationInscription(ins, ps, ecole, aujourdhui, (articles ?? []).filter((a) => a.inscription_id === ins.id)) : null;
          // Frais uniques, puis services mensuels regroupés (une ligne par service, pas par mois)
          const uniques = s ? s.articles.filter((a) => a.nature === "unique") : [];
          const services = new Map<string, { libelle: string; du: number; paye: number; resteEchu: number }>();
          for (const a of s?.articles ?? []) {
            if (a.nature !== "mensuel") continue;
            const cumul = services.get(a.article_id) ?? { libelle: a.libelle.split(" — ")[0], du: 0, paye: 0, resteEchu: 0 };
            cumul.du += a.du;
            cumul.paye += a.paye;
            cumul.resteEchu += a.resteEchu;
            services.set(a.article_id, cumul);
          }
          // Une ligne par reçu (la RLS parent ne renvoie déjà pas les annulés ; le filtre reste par prudence)
          const recus = regrouperParRecu(ps.filter((p) => !p.annule).map((p) => ({ ...p, motif_annulation: null })));
          return (
            <section key={enfant.id} className="bg-white rounded-3xl p-5 shadow-sm border border-neutral-100 space-y-4">
              <div className="flex justify-between items-start">
                <div>
                  <h2 className="text-sm font-extrabold">{enfant.prenom} {enfant.nom}</h2>
                  <p className="text-[11px] text-neutral-500">
                    {ins ? classeNom.get(ins.classe_id) : `Pas encore inscrit en ${ecole.annee_scolaire}`} · Matricule {enfant.matricule}
                  </p>
                  {ins && ins.statut !== "active" && ins.date_depart && (
                    <p className="text-[11px] text-neutral-600">Départ enregistré le {formatDate(ins.date_depart)}</p>
                  )}
                </div>
                {s && (s.arriere === 0 ? (
                  <span className="flex items-center gap-1 text-[11px] font-bold text-jang-700"><CheckCircle2 className="w-4 h-4" /> À jour</span>
                ) : (
                  <span className="text-right">
                    <span className="block text-[10px] text-neutral-500">Reste à payer</span>
                    <span className="text-sm font-extrabold text-red-600">{formatFCFA(s.arriere)}</span>
                  </span>
                ))}
              </div>

              {s && (
                <>
                  <div className="grid grid-cols-5 gap-1.5">
                    {/* Élève parti : les mois qui ne sont plus dus (après le départ, non payés) sont masqués */}
                    {s.mois.filter((m) => !(ins?.date_depart && ins.statut !== "active" && m.statut === "non_du" && m.paye === 0)).map((m) => (
                      <div key={m.mois} className={cn("rounded-xl border py-1.5 text-center", STYLE[m.statut])}>
                        <p className="text-[10px] font-bold capitalize">{formatMoisCourt(m.mois)}</p>
                        <p className="text-[9px]">
                          {m.statut === "paye" ? "✓" : m.tranches && m.reste > 0 ? `${m.tranches.echues}/${m.tranches.total}` : m.statut === "retard" ? "dû" : m.statut === "partiel" ? "partiel" : "·"}
                        </p>
                      </div>
                    ))}
                  </div>
                  {s.mois.map((m) =>
                    m.tranches && m.reste > 0 ? (
                      <p key={m.mois} className="text-[11px] text-neutral-700 bg-jang-50 rounded-xl p-2.5">
                        <b className="capitalize">{formatMois(m.mois)}</b> se paie en {m.tranches.total} tranches de {formatFCFA(m.tranches.montant)} :{" "}
                        {formatFCFA(m.paye)} versés sur {formatFCFA(m.du)}
                        {m.resteEchu > 0
                          ? ` · ${formatFCFA(m.resteEchu)} à régler maintenant`
                          : m.tranches.prochaine
                            ? ` · prochaine tranche le ${formatDate(m.tranches.prochaine)}`
                            : ""}
                      </p>
                    ) : null
                  )}
                  {(uniques.length > 0 || services.size > 0) && (
                    <ul className="text-[11px] text-neutral-700 space-y-1">
                      {uniques.map((a) => (
                        <li key={a.cle} className="flex justify-between gap-2">
                          <span>{a.libelle}</span>
                          <span className={cn("font-bold", a.reste === 0 ? "text-jang-700" : "text-red-600")}>
                            {a.reste === 0 ? "✓ payé" : `${formatFCFA(a.reste)} à régler`}
                          </span>
                        </li>
                      ))}
                      {[...services.entries()].map(([id, v]) => (
                        <li key={id} className="flex justify-between gap-2">
                          <span>{v.libelle} (mensuel)</span>
                          <span className={cn("font-bold", v.resteEchu === 0 ? "text-jang-700" : "text-red-600")}>
                            {v.resteEchu === 0 ? `✓ à jour · ${formatFCFA(v.paye)} versés` : `${formatFCFA(v.resteEchu)} à régler`}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="text-[11px] text-neutral-500">
                    Payé cette année : <b className="text-neutral-800">{formatFCFA(s.totalPaye)}</b> · Reste sur l'année : <b className="text-neutral-800">{formatFCFA(s.resteAnnee)}</b>
                  </p>
                </>
              )}

              {recus.length > 0 && (
                <ul className="divide-y divide-neutral-100 border-t border-neutral-100">
                  {recus.map((r) => {
                    const p = r.premiere;
                    const entete = (
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold">
                          {resumeRecu(r.lignes)} · {formatFCFA(r.total)}
                        </p>
                        <p className="text-[10px] text-neutral-500">{formatDate(p.paye_le)} · {LIBELLE_MODE[p.mode]} · {p.numero_recu}{estRecuDeReprise(p.encaisse_par) ? " · Reprise de l'existant" : p.encaisse_par ? ` · Encaissé par ${p.encaisse_par}` : ""}</p>
                      </div>
                    );
                    const lien = (
                      <a href={`/parent/${token}/recu/${p.id}`} className="flex items-center gap-1 text-[11px] font-bold text-jang-700">
                        <FileText className="w-4 h-4" /> Reçu
                      </a>
                    );
                    return (
                      <li key={r.cle} className="py-2">
                        {r.lignes.length > 1 ? (
                          // Détail dépliable sans JavaScript (<details> natif)
                          <details className="group">
                            <summary className="flex items-center gap-2 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                              <ChevronRight className="w-3.5 h-3.5 text-neutral-400 shrink-0 transition-transform group-open:rotate-90" />
                              {entete}
                              {lien}
                            </summary>
                            <ul className="mt-1.5 pl-5 space-y-0.5">
                              {r.lignes.map((l) => (
                                <li key={l.id} className="flex justify-between gap-2 text-[11px] text-neutral-600">
                                  <span>{libellePaiement(l)}</span>
                                  <span>{formatFCFA(l.montant)}</span>
                                </li>
                              ))}
                            </ul>
                          </details>
                        ) : (
                          <div className="flex items-center gap-2">
                            {entete}
                            {lien}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}

        {ecole.telephone_contact && (
          <a href={`tel:${ecole.telephone_contact}`} className="flex items-center justify-center gap-2 bg-white rounded-2xl py-3 text-xs font-bold text-neutral-700 border border-neutral-200">
            <Phone className="w-4 h-4" /> Contacter l'administration
          </a>
        )}
        <p className="text-center text-[10px] text-neutral-400">Lien personnel : ne le partagez pas. Propulsé par FayJàng.</p>
      </main>
    </div>
  );
}
