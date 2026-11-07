import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CheckCircle2, FileText, GraduationCap, Phone } from "lucide-react";
import { echangerJetonParent } from "@/lib/supabase/server";
import { todayDakar } from "@/lib/config";
import { formatDate, formatMois, formatMoisCourt } from "@/lib/dates";
import { LIBELLE_MODE, libellePaiement } from "@/lib/libelles";
import { situationInscription, type StatutMois } from "@/lib/scolarite";
import { cn, formatFCFA } from "@/lib/utils";

export const dynamic = "force-dynamic";

// Lien personnel : jamais indexé
export const metadata: Metadata = { title: "Suivi de scolarité — JàngPay", robots: { index: false, follow: false } };

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
    supabase.from("ecoles").select("nom, ville, telephone_contact, annee_scolaire, mois_debut, nb_mensualites, jour_echeance, tranches_dernier_mois, mois_debut_tranches, nb_tranches").eq("id", ecoleId).maybeSingle(),
    supabase.from("parents").select("nom").eq("id", parentId).maybeSingle(),
    supabase.from("eleves").select("id, prenom, nom, matricule").eq("ecole_id", ecoleId).eq("parent_id", parentId).eq("is_active", true).order("prenom"),
  ]);
  if (!ecole || !parent) notFound();

  const idsEnfants = (enfants ?? []).map((e) => e.id);
  const { data: inscriptions } = idsEnfants.length
    ? await supabase
        .from("inscriptions")
        .select("id, eleve_id, classe_id, annee_scolaire, frais_inscription, mensualite, reduction_mensuelle, statut")
        .eq("ecole_id", ecoleId)
        .eq("annee_scolaire", ecole.annee_scolaire)
        .in("eleve_id", idsEnfants)
    : { data: [] };
  const idsIns = (inscriptions ?? []).map((i) => i.id);
  const [{ data: paiements }, { data: classes }] = await Promise.all([
    idsIns.length
      ? supabase
          .from("paiements")
          .select("id, inscription_id, numero_recu, type, mois, montant, mode, libelle, paye_le, annule")
          .eq("ecole_id", ecoleId)
          .in("inscription_id", idsIns)
          .order("paye_le", { ascending: false })
      : Promise.resolve({ data: [] as never[] }),
    supabase.from("classes").select("id, nom").eq("ecole_id", ecoleId),
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
          const s = ins ? situationInscription(ins, ps, ecole, aujourdhui) : null;
          return (
            <section key={enfant.id} className="bg-white rounded-3xl p-5 shadow-sm border border-neutral-100 space-y-4">
              <div className="flex justify-between items-start">
                <div>
                  <h2 className="text-sm font-extrabold">{enfant.prenom} {enfant.nom}</h2>
                  <p className="text-[11px] text-neutral-500">
                    {ins ? classeNom.get(ins.classe_id) : `Pas encore inscrit en ${ecole.annee_scolaire}`} · Matricule {enfant.matricule}
                  </p>
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
                    {s.mois.map((m) => (
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
                  <p className="text-[11px] text-neutral-500">
                    Payé cette année : <b className="text-neutral-800">{formatFCFA(s.totalPaye)}</b> · Reste sur l'année : <b className="text-neutral-800">{formatFCFA(s.resteAnnee)}</b>
                  </p>
                </>
              )}

              {ps.filter((p) => !p.annule).length > 0 && (
                <ul className="divide-y divide-neutral-100 border-t border-neutral-100">
                  {ps.filter((p) => !p.annule).map((p) => (
                    <li key={p.id} className="py-2 flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold">
                          {libellePaiement(p)} · {formatFCFA(p.montant)}
                        </p>
                        <p className="text-[10px] text-neutral-500">{formatDate(p.paye_le)} · {LIBELLE_MODE[p.mode]} · {p.numero_recu}</p>
                      </div>
                      <a href={`/p/${token}/recu/${p.id}`} className="flex items-center gap-1 text-[11px] font-bold text-jang-700">
                        <FileText className="w-4 h-4" /> Reçu
                      </a>
                    </li>
                  ))}
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
        <p className="text-center text-[10px] text-neutral-400">Lien personnel : ne le partagez pas. Propulsé par JàngPay.</p>
      </main>
    </div>
  );
}
