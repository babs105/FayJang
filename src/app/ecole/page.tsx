import { redirect } from "next/navigation";
import { createClientEcole } from "@/lib/supabase/server";
import { getEcoleId } from "@/lib/ecole-session";
import { getAppBaseUrl, todayDakar } from "@/lib/config";
import { situationInscription } from "@/lib/scolarite";
import { derniereModification } from "@/lib/modifications";
import { EcoleDashboardClient } from "./ecole-dashboard-client";
import type { ClasseVue, EcoleVue, EleveVue, PaiementVue } from "./types";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ bienvenue?: string }>;
}

export default async function EcolePage({ searchParams }: PageProps) {
  const ecoleId = await getEcoleId();
  if (!ecoleId) redirect("/ecole/login");

  const { bienvenue } = await searchParams;
  const supabase = createClientEcole(ecoleId);
  const aujourdhui = todayDakar();
  const appBaseUrl = getAppBaseUrl();

  const { data: ecole, error: erreurEcole } = await supabase
    .from("ecoles")
    .select(
      "id, nom, slug, ville, adresse, responsable_nom, email_contact, telephone_contact, annee_scolaire, mois_debut, nb_mensualites, jour_echeance, tranches_dernier_mois, mois_debut_tranches, nb_tranches, rang_mois_tranches, premier_mois_a_linscription, dernier_mois_a_linscription, plan, statut_abonnement, trial_ends_at, abonnement_fin"
    )
    .eq("id", ecoleId)
    .maybeSingle();

  if (erreurEcole) {
    console.error("[ecole/page] lecture de l'école :", erreurEcole.code ?? "erreur");
    const migrationManquante = ["42703", "42P01", "PGRST204", "PGRST202"].includes(erreurEcole.code ?? "");
    return <ErreurBase migrationManquante={migrationManquante} />;
  }
  if (!ecole) redirect("/ecole/login");

  const annee = ecole.annee_scolaire;
  const lectures = await Promise.all([
    supabase
      .from("classes")
      .select("id, nom, niveau, frais_inscription, mensualite, mensualite_dernier_mois, is_active")
      .eq("ecole_id", ecoleId)
      .eq("annee_scolaire", annee)
      .order("nom"),
    supabase
      .from("eleves")
      .select("id, matricule, matricule_ancien, prenom, nom, sexe, date_naissance, parent_id, created_at, updated_at")
      .eq("ecole_id", ecoleId)
      .eq("is_active", true)
      .order("nom"),
    supabase.from("parents").select("id, nom, telephone, token, created_at, updated_at").eq("ecole_id", ecoleId),
    supabase
      .from("inscriptions")
      .select("id, eleve_id, classe_id, annee_scolaire, frais_inscription, mensualite, mensualite_dernier_mois, reduction_mensuelle, statut, date_depart, created_at, updated_at")
      .eq("ecole_id", ecoleId)
      .eq("annee_scolaire", annee),
    supabase
      .from("articles_classe")
      .select("id, classe_id, libelle, nature, prix_unitaire, quantite_defaut, obligatoire")
      .eq("ecole_id", ecoleId)
      .order("ordre"),
  ]);
  // Une lecture en échec (colonne absente : schéma pas encore relancé) ne doit pas afficher une école vide
  const erreurLecture = lectures.find((r) => r.error)?.error;
  if (erreurLecture) {
    console.error("[ecole/page] lecture des données :", erreurLecture.code ?? "erreur");
    return <ErreurBase migrationManquante={["42703", "42P01", "PGRST204", "PGRST202"].includes(erreurLecture.code ?? "")} />;
  }
  const [{ data: classes }, { data: eleves }, { data: parents }, { data: inscriptions }, { data: catalogue }] = lectures;

  const idsInscriptions = (inscriptions ?? []).map((i) => i.id);
  const lecturesSuivi = idsInscriptions.length
    ? await Promise.all([
        supabase
          .from("paiements")
          .select("id, inscription_id, lot_id, numero_recu, type, mois, montant, mode, reference, libelle, paye_le, annule, motif_annulation, article_id, encaisse_par")
          .eq("ecole_id", ecoleId)
          .in("inscription_id", idsInscriptions)
          .order("created_at", { ascending: false }),
        supabase
          .from("articles_inscription")
          .select("id, inscription_id, libelle, nature, prix_unitaire, quantite, obligatoire, mois_debut, mois_fin, created_at, updated_at")
          .eq("ecole_id", ecoleId)
          .in("inscription_id", idsInscriptions)
          .order("created_at"),
      ])
    : null;
  // Paiements ou articles illisibles : des soldes faux seraient affichés, on s'arrête
  const erreurSuivi = lecturesSuivi?.find((r) => r.error)?.error;
  if (erreurSuivi) {
    console.error("[ecole/page] lecture des paiements et articles :", erreurSuivi.code ?? "erreur");
    return <ErreurBase migrationManquante={["42703", "42P01", "PGRST204", "PGRST202"].includes(erreurSuivi.code ?? "")} />;
  }
  const paiements = lecturesSuivi?.[0].data ?? [];
  const articlesEleves = lecturesSuivi?.[1].data ?? [];
  const articlesParInscription = new Map<string, Array<NonNullable<typeof articlesEleves>[number]>>();
  for (const a of articlesEleves ?? []) {
    articlesParInscription.set(a.inscription_id, [...(articlesParInscription.get(a.inscription_id) ?? []), a]);
  }

  const classeParId = new Map((classes ?? []).map((c) => [c.id, c]));
  const parentParId = new Map((parents ?? []).map((p) => [p.id, p]));
  const inscriptionParEleve = new Map((inscriptions ?? []).map((i) => [i.eleve_id, i]));
  const eleveParInscription = new Map<string, { eleveId: string; nom: string; classe: string }>();
  const paiementsParInscription = new Map<string, Array<NonNullable<typeof paiements>[number]>>();
  for (const p of paiements ?? []) {
    const liste = paiementsParInscription.get(p.inscription_id) ?? [];
    liste.push(p);
    paiementsParInscription.set(p.inscription_id, liste);
  }

  const elevesVue: EleveVue[] = (eleves ?? []).map((e) => {
    const ins = inscriptionParEleve.get(e.id);
    const parent = e.parent_id ? parentParId.get(e.parent_id) : undefined;
    const classeNom = ins ? (classeParId.get(ins.classe_id)?.nom ?? "—") : "";
    if (ins) eleveParInscription.set(ins.id, { eleveId: e.id, nom: `${e.prenom} ${e.nom}`, classe: classeNom });
    return {
      id: e.id,
      matricule: e.matricule,
      matricule_ancien: e.matricule_ancien,
      prenom: e.prenom,
      nom: e.nom,
      sexe: e.sexe,
      date_naissance: e.date_naissance,
      parent: parent ? { id: parent.id, nom: parent.nom, telephone: parent.telephone, lien: `${appBaseUrl}/p/${parent.token}` } : null,
      inscription: ins
        ? {
            id: ins.id,
            classe_id: ins.classe_id,
            classe_nom: classeNom,
            statut: ins.statut,
            date_depart: ins.date_depart,
            frais_inscription: ins.frais_inscription,
            mensualite: ins.mensualite,
            mensualite_dernier_mois: ins.mensualite_dernier_mois,
            reduction_mensuelle: ins.reduction_mensuelle,
          }
        : null,
      derniere_modification: derniereModification([e, ins, parent, ...(ins ? (articlesParInscription.get(ins.id) ?? []) : [])]),
      situation: ins ? situationInscription(ins, paiementsParInscription.get(ins.id) ?? [], ecole, aujourdhui, articlesParInscription.get(ins.id) ?? []) : null,
    };
  });

  const paiementsVue: PaiementVue[] = (paiements ?? []).map((p) => {
    const e = eleveParInscription.get(p.inscription_id);
    return {
      id: p.id,
      inscription_id: p.inscription_id,
      lot_id: p.lot_id,
      numero_recu: p.numero_recu,
      type: p.type,
      mois: p.mois,
      montant: p.montant,
      mode: p.mode,
      reference: p.reference,
      libelle: p.libelle,
      paye_le: p.paye_le,
      annule: p.annule,
      motif_annulation: p.motif_annulation,
      encaisse_par: p.encaisse_par,
      eleve_id: e?.eleveId ?? "",
      eleve_nom: e?.nom ?? "Élève retiré",
      classe_nom: e?.classe ?? "",
    };
  });

  const effectifs = new Map<string, number>();
  for (const i of inscriptions ?? []) {
    if (i.statut === "active") effectifs.set(i.classe_id, (effectifs.get(i.classe_id) ?? 0) + 1);
  }
  const classesVue: ClasseVue[] = (classes ?? []).map((c) => ({
    ...c,
    effectif: effectifs.get(c.id) ?? 0,
    articles: (catalogue ?? []).filter((a) => a.classe_id === c.id).map(({ classe_id: _c, ...a }) => a),
  }));

  return (
    <EcoleDashboardClient
      ecole={ecole as EcoleVue}
      classes={classesVue}
      eleves={elevesVue}
      paiements={paiementsVue}
      aujourdhui={aujourdhui}
      bienvenue={bienvenue === "1"}
      numeroWave={process.env.WAVE_NUMERO_PAIEMENT || null}
    />
  );
}

function ErreurBase({ migrationManquante }: { migrationManquante: boolean }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-md bg-white border border-neutral-200 rounded-3xl p-6 text-sm text-neutral-700 space-y-2">
        <h1 className="font-extrabold text-neutral-900">Lecture des données impossible</h1>
        <p>
          {migrationManquante
            ? "La base n'est pas à jour : relancez supabase/schema.sql dans l'éditeur SQL Supabase."
            : "Réessayez dans un instant. Si le problème persiste, contactez le support FayJàng."}
        </p>
      </div>
    </div>
  );
}
