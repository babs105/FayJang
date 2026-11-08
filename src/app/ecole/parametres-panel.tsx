"use client";

import { useState, useTransition } from "react";
import { formatDate, formatMois } from "@/lib/dates";
import { formatFCFA } from "@/lib/utils";
import { maxTranches, moisDesTranches } from "@/lib/scolarite";
import { Badge, Bouton, Carte, Label, Message, champ } from "@/components/ui";
import { changerCodeAcces, enregistrerParametres } from "./actions";
import type { DonneesEcole } from "./ecole-dashboard-client";

const MOIS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

export function ParametresPanel({ ecole, numeroWave }: DonneesEcole & { numeroWave: string | null }) {
  const [f, setF] = useState({
    nom: ecole.nom,
    ville: ecole.ville ?? "",
    adresse: ecole.adresse ?? "",
    responsable_nom: ecole.responsable_nom ?? "",
    telephone_contact: ecole.telephone_contact ?? "",
    annee_scolaire: ecole.annee_scolaire,
    mois_debut: String(ecole.mois_debut),
    nb_mensualites: String(ecole.nb_mensualites),
    jour_echeance: String(ecole.jour_echeance),
    tranches_dernier_mois: ecole.tranches_dernier_mois,
    mois_debut_tranches: String(ecole.mois_debut_tranches ?? 1),
    nb_tranches: ecole.nb_tranches ? String(ecole.nb_tranches) : "",
  });
  const [code, setCode] = useState({ ancien: "", nouveau: "" });
  const [retour, setRetour] = useState<{ ok: boolean; texte: string } | null>(null);
  const [isPending, startTransition] = useTransition();
  const maj = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  function executer(action: () => Promise<{ success: boolean; message?: string }>) {
    setRetour(null);
    startTransition(async () => {
      const r = await action();
      setRetour({ ok: r.success, texte: r.message ?? (r.success ? "Enregistré." : "Opération impossible.") });
    });
  }

  const changementAnnee = f.annee_scolaire !== ecole.annee_scolaire;
  // Aperçu des tranches avec les valeurs saisies (même calcul que le serveur)
  const calendrier = {
    mois_debut: Number(f.mois_debut),
    nb_mensualites: Number(f.nb_mensualites) || 0,
    jour_echeance: Number(f.jour_echeance) || 1,
    tranches_dernier_mois: true,
    mois_debut_tranches: Number(f.mois_debut_tranches),
  };
  const anneeValide = /^\d{4}-\d{4}$/.test(f.annee_scolaire);
  // Nombre de tranches : au plus jusqu'à l'avant-dernier mois ; vide = le maximum
  const nbMax = anneeValide ? maxTranches(f.annee_scolaire, calendrier, calendrier.mois_debut_tranches) : 0;
  const nbTranches = Math.min(Number(f.nb_tranches) || nbMax, nbMax);
  const apercu = anneeValide && nbTranches > 0 ? moisDesTranches(f.annee_scolaire, { ...calendrier, nb_tranches: nbTranches }) : [];
  const moisAnnee = /^\d{4}-\d{4}$/.test(f.annee_scolaire) && calendrier.nb_mensualites > 1
    ? Array.from({ length: calendrier.nb_mensualites - 1 }, (_, i) => ((calendrier.mois_debut - 1 + i) % 12) + 1)
    : [];
  const dernierMois = MOIS[(calendrier.mois_debut - 2 + calendrier.nb_mensualites + 12) % 12];

  return (
    <div className="grid lg:grid-cols-3 gap-4">
      <Carte className="lg:col-span-2 space-y-4">
        <h3 className="text-sm font-extrabold">École et calendrier</h3>
        {retour && <Message ok={retour.ok}>{retour.texte}</Message>}
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (changementAnnee && !confirm(`Passer à l'année ${f.annee_scolaire} ? Les classes seront reprises et les élèves devront être réinscrits.`)) return;
            executer(() => enregistrerParametres({ ...f, nb_tranches: nbTranches }));
          }}
        >
          <div className="grid sm:grid-cols-2 gap-3">
            <div><Label>Nom de l'école</Label><input value={f.nom} onChange={maj("nom")} className={champ} /></div>
            <div><Label>Responsable</Label><input value={f.responsable_nom} onChange={maj("responsable_nom")} className={champ} /></div>
            <div><Label>Ville</Label><input value={f.ville} onChange={maj("ville")} placeholder="Dakar, Thiès..." className={champ} /></div>
            <div><Label>Téléphone</Label><input value={f.telephone_contact} onChange={maj("telephone_contact")} className={champ} /></div>
            <div className="sm:col-span-2"><Label>Adresse (sur les reçus)</Label><input value={f.adresse} onChange={maj("adresse")} className={champ} /></div>
          </div>
          <div className="grid sm:grid-cols-4 gap-3">
            <div><Label>Année scolaire</Label><input value={f.annee_scolaire} onChange={maj("annee_scolaire")} placeholder="2026-2027" className={champ} /></div>
            <div>
              <Label>1ʳᵉ mensualité</Label>
              <select value={f.mois_debut} onChange={maj("mois_debut")} className={champ}>
                {MOIS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
            </div>
            <div><Label>Nb de mensualités</Label><input inputMode="numeric" value={f.nb_mensualites} onChange={maj("nb_mensualites")} className={champ} /></div>
            <div><Label>Échéance (jour)</Label><input inputMode="numeric" value={f.jour_echeance} onChange={maj("jour_echeance")} className={champ} /></div>
          </div>
          <div className="rounded-2xl border border-neutral-200 p-3 space-y-2">
            <label className="flex items-center gap-2 text-xs font-bold">
              <input
                type="checkbox"
                checked={f.tranches_dernier_mois}
                onChange={(e) => setF({ ...f, tranches_dernier_mois: e.target.checked })}
              />
              Faire payer le dernier mois ({dernierMois?.toLowerCase()}) par tranches
            </label>
            {f.tranches_dernier_mois && (
              <>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span>Première tranche avec la mensualité de</span>
                  <select value={f.mois_debut_tranches} onChange={maj("mois_debut_tranches")} className={`${champ} w-auto`}>
                    {moisAnnee.map((m) => <option key={m} value={m}>{MOIS[m - 1]}</option>)}
                  </select>
                  <span>en</span>
                  <select value={String(nbTranches)} onChange={maj("nb_tranches")} disabled={nbMax === 0} className={`${champ} w-auto`}>
                    {Array.from({ length: nbMax }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>{n} tranche{n > 1 ? "s" : ""}</option>
                    ))}
                  </select>
                </div>
                <p className="text-[11px] text-neutral-600 bg-neutral-50 rounded-xl p-2.5">
                  {apercu.length > 0 ? (
                    <>
                      {dernierMois} est réparti en <b>{apercu.length} tranche{apercu.length > 1 ? "s" : ""}</b> égales, dues avec les mensualités
                      de {apercu.map((m) => formatMois(m).split(" ")[0]).join(", ")}. Exemple : pour une mensualité de {formatFCFA(20000)},{" "}
                      {formatFCFA(Math.floor(20000 / apercu.length))} de plus par mois. Le dernier mois est ainsi soldé avant son échéance.
                    </>
                  ) : (
                    "Choisissez un mois de l'année scolaire situé avant le dernier mois."
                  )}
                </p>
              </>
            )}
          </div>
          {changementAnnee && (
            <p className="text-[11px] text-amber-700 bg-amber-50 rounded-xl p-2.5">
              Nouvelle année : les classes actives seront copiées avec leurs tarifs. L'historique de {ecole.annee_scolaire} reste conservé.
            </p>
          )}
          <Bouton type="submit" disabled={isPending}>Enregistrer</Bouton>
        </form>
      </Carte>

      <div className="space-y-4">
        <Carte className="space-y-2">
          <h3 className="text-sm font-extrabold">Abonnement FayJàng</h3>
          <div className="flex items-center gap-2 text-xs">
            <Badge ton={ecole.statut_abonnement === "actif" ? "vert" : ecole.statut_abonnement === "essai" ? "bleu" : "rouge"}>
              {ecole.statut_abonnement === "essai" ? "Essai gratuit" : ecole.statut_abonnement === "actif" ? "Actif" : ecole.statut_abonnement === "expire" ? "Expiré" : "Suspendu"}
            </Badge>
            <span className="text-neutral-500">
              {ecole.statut_abonnement === "essai" && ecole.trial_ends_at && `jusqu'au ${formatDate(ecole.trial_ends_at)}`}
              {ecole.statut_abonnement === "actif" && ecole.abonnement_fin && `jusqu'au ${formatDate(ecole.abonnement_fin)}`}
            </span>
          </div>
          {numeroWave && (
            <p className="text-[11px] text-neutral-600">Règlement par Wave au <b>{numeroWave}</b>, en indiquant l'identifiant <b>{ecole.slug}</b>.</p>
          )}
          <p className="text-[11px] text-neutral-500">Identifiant de connexion : <b>{ecole.slug}</b>{ecole.email_contact ? ` ou ${ecole.email_contact}` : ""}</p>
        </Carte>

        <Carte className="space-y-3">
          <h3 className="text-sm font-extrabold">Code d'accès</h3>
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              executer(() => changerCodeAcces(code.ancien, code.nouveau));
              setCode({ ancien: "", nouveau: "" });
            }}
          >
            <input type="password" autoComplete="current-password" placeholder="Code actuel" value={code.ancien} onChange={(e) => setCode({ ...code, ancien: e.target.value })} className={champ} />
            <input type="password" autoComplete="new-password" placeholder="Nouveau code (8 caractères min.)" value={code.nouveau} onChange={(e) => setCode({ ...code, nouveau: e.target.value })} className={champ} />
            <Bouton type="submit" variante="sombre" disabled={isPending || !code.ancien || code.nouveau.length < 8} className="w-full">Changer le code</Bouton>
          </form>
        </Carte>
      </div>
    </div>
  );
}
