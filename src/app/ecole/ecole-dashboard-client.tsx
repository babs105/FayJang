"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, BarChart3, GraduationCap, LogOut, Receipt, School, Settings, Upload, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { logoutEcoleAction } from "./login/actions";
import { TableauPanel } from "./tableau-panel";
import { ElevesPanel } from "./eleves-panel";
import { PaiementsPanel } from "./paiements-panel";
import { ImpayesPanel } from "./impayes-panel";
import { ClassesPanel } from "./classes-panel";
import { ParametresPanel } from "./parametres-panel";
import { FicheEleve } from "./fiche-eleve";
import { BandeauAbonnement } from "./bandeau-abonnement";
import type { SituationAbonnement } from "@/lib/abonnement";
import type { ClasseVue, EcoleVue, EleveVue, PaiementVue } from "./types";

export type Onglet = "tableau" | "eleves" | "paiements" | "impayes" | "classes" | "parametres";

const ONGLETS: { id: Onglet; label: string; icone: typeof BarChart3 }[] = [
  { id: "tableau", label: "Tableau de bord", icone: BarChart3 },
  { id: "eleves", label: "Élèves", icone: Users },
  { id: "paiements", label: "Paiements", icone: Receipt },
  { id: "impayes", label: "Impayés", icone: AlertTriangle },
  { id: "classes", label: "Classes", icone: GraduationCap },
  { id: "parametres", label: "Paramètres", icone: Settings },
];

export interface DonneesEcole {
  ecole: EcoleVue;
  classes: ClasseVue[];
  eleves: EleveVue[];
  paiements: PaiementVue[];
  aujourdhui: string;
  /** État de l'abonnement calculé par le serveur (alerte, grâce, lecture seule) */
  abonnement: SituationAbonnement;
}

export function EcoleDashboardClient(props: DonneesEcole & { bienvenue: boolean; numeroWave: string | null }) {
  const [onglet, setOnglet] = useState<Onglet>(props.classes.length === 0 ? "classes" : "tableau");
  const [eleveOuvert, setEleveOuvert] = useState<string | null>(null);
  const [bienvenue, setBienvenue] = useState(props.bienvenue);
  const nbImpayes = props.eleves.filter((e) => (e.situation?.arriere ?? 0) > 0).length;
  const eleve = props.eleves.find((e) => e.id === eleveOuvert) ?? null;

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="bg-white border-b border-neutral-100 sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 bg-jang-600 text-white rounded-xl flex items-center justify-center shrink-0">
              <School className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-extrabold text-neutral-900 truncate">{props.ecole.nom}</p>
              <p className="text-[11px] text-neutral-500">
                Espace École · Année {props.ecole.annee_scolaire}
              </p>
            </div>
          </div>
          <form action={logoutEcoleAction}>
            <button className="text-xs font-bold text-neutral-500 hover:text-neutral-900 flex items-center gap-1">
              <LogOut className="w-4 h-4" /> <span className="hidden sm:inline">Déconnexion</span>
            </button>
          </form>
        </div>
        <nav className="max-w-6xl mx-auto px-2 flex gap-1 overflow-x-auto no-scrollbar">
          {ONGLETS.map(({ id, label, icone: Icone }) => (
            <button
              key={id}
              onClick={() => setOnglet(id)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2.5 text-xs font-bold border-b-2 whitespace-nowrap transition",
                onglet === id ? "border-jang-600 text-jang-700" : "border-transparent text-neutral-500 hover:text-neutral-800"
              )}
            >
              <Icone className="w-4 h-4" />
              {label}
              {id === "impayes" && nbImpayes > 0 && (
                <span className="ml-0.5 px-1.5 rounded-full bg-red-500 text-white text-[10px]">{nbImpayes}</span>
              )}
            </button>
          ))}
          <Link
            href="/ecole/import"
            className="flex items-center gap-1.5 px-3 py-2.5 text-xs font-bold border-b-2 border-transparent whitespace-nowrap text-neutral-500 hover:text-neutral-800 transition"
          >
            <Upload className="w-4 h-4" />
            Importer
          </Link>
        </nav>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-4">
        <BandeauAbonnement ecole={props.ecole} abonnement={props.abonnement} numeroWave={props.numeroWave} />
        {bienvenue && (
          <div className="p-4 rounded-3xl bg-jang-50 border border-jang-100 text-xs text-jang-800 flex justify-between gap-3">
            <p>
              <b>Bienvenue sur FayJàng !</b> Commencez par créer vos classes et leurs tarifs, puis inscrivez vos élèves.
              Chaque parent reçoit un lien pour suivre les paiements et télécharger ses reçus.
            </p>
            <button onClick={() => setBienvenue(false)} className="font-bold shrink-0">OK</button>
          </div>
        )}

        {onglet === "tableau" && <TableauPanel {...props} ouvrirEleve={setEleveOuvert} allerA={setOnglet} />}
        {onglet === "eleves" && <ElevesPanel {...props} ouvrirEleve={setEleveOuvert} />}
        {onglet === "paiements" && <PaiementsPanel {...props} ouvrirEleve={setEleveOuvert} />}
        {onglet === "impayes" && <ImpayesPanel {...props} ouvrirEleve={setEleveOuvert} />}
        {onglet === "classes" && <ClassesPanel {...props} />}
        {onglet === "parametres" && <ParametresPanel {...props} />}
      </main>

      {eleve && (
        <FicheEleve
          eleve={eleve}
          ecole={props.ecole}
          classes={props.classes}
          aujourdhui={props.aujourdhui}
          paiements={props.paiements.filter((p) => p.eleve_id === eleve.id)}
          onClose={() => setEleveOuvert(null)}
        />
      )}
    </div>
  );
}
