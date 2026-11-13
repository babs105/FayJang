"use client";

import { useState, useTransition } from "react";
import { Check, ChevronDown, Copy } from "lucide-react";
import { Bouton, Carte, Label, Message, champ } from "@/components/ui";
import { MOT_DE_PASSE_MIN } from "@/lib/securite/mot-de-passe";
import { creerEcole } from "@/app/admin/actions/ecoles";

const VIDE = { nom: "", ville: "", responsable: "", email: "", telephone: "", code: "" };
type Identifiants = { nom: string; email: string; motDePasse: string };

/** Formulaire repliable « Créer une école » ; les identifiants à transmettre ne s'affichent qu'une fois */
export function CreerEcole() {
  const [ouvert, setOuvert] = useState(false);
  const [f, setF] = useState(VIDE);
  const [erreur, setErreur] = useState<string | null>(null);
  const [identifiants, setIdentifiants] = useState<Identifiants | null>(null);
  const [copie, setCopie] = useState(false);
  const [isPending, startTransition] = useTransition();
  const maj = (k: keyof typeof VIDE) => (e: React.ChangeEvent<HTMLInputElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  const soumettre = (e: React.FormEvent) => {
    e.preventDefault();
    setErreur(null);
    startTransition(async () => {
      const r = await creerEcole(f);
      if (!r.success || !r.data) return setErreur(r.message ?? "Création impossible.");
      setIdentifiants(r.data);
      setCopie(false);
      setF(VIDE);
      setOuvert(false);
    });
  };

  const copier = async (i: Identifiants) => {
    try {
      await navigator.clipboard.writeText(`E-mail : ${i.email}\nMot de passe : ${i.motDePasse}`);
      setCopie(true);
    } catch {
      setErreur("Copie impossible : recopiez les identifiants à la main.");
    }
  };

  return (
    <div className="space-y-3">
      {identifiants && (
        <Carte className="space-y-2 border-jang-200">
          <p className="text-xs font-extrabold">Identifiants à transmettre : {identifiants.nom}</p>
          <p className="text-[11px] text-neutral-500">Notez-les maintenant : le mot de passe ne sera plus affiché.</p>
          <div className="text-xs bg-neutral-50 border border-neutral-200 rounded-xl p-3 space-y-1 font-mono break-all">
            <p>E-mail : {identifiants.email}</p>
            <p>Mot de passe : {identifiants.motDePasse}</p>
          </div>
          <div className="flex gap-2">
            <Bouton variante="sombre" onClick={() => copier(identifiants)}>
              {copie ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />} {copie ? "Copié" : "Copier"}
            </Bouton>
            <Bouton variante="secondaire" onClick={() => setIdentifiants(null)}>
              Fermer
            </Bouton>
          </div>
        </Carte>
      )}

      <Carte className="space-y-3">
        <button type="button" className="w-full flex items-center justify-between text-xs font-extrabold" onClick={() => setOuvert((o) => !o)} aria-expanded={ouvert}>
          Créer une école
          <ChevronDown className={`w-4 h-4 transition ${ouvert ? "rotate-180" : ""}`} />
        </button>
        {ouvert && (
          <form className="space-y-3" onSubmit={soumettre}>
            {erreur && <Message ok={false}>{erreur}</Message>}
            <div>
              <Label>Nom de l&apos;école</Label>
              <input className={champ} value={f.nom} onChange={maj("nom")} maxLength={100} required />
            </div>
            <div>
              <Label>Ville (facultatif)</Label>
              <input className={champ} value={f.ville} onChange={maj("ville")} maxLength={60} />
            </div>
            <div>
              <Label>Responsable (directeur)</Label>
              <input className={champ} value={f.responsable} onChange={maj("responsable")} maxLength={80} required />
            </div>
            <div>
              <Label>E-mail de connexion</Label>
              <input className={champ} type="email" value={f.email} onChange={maj("email")} maxLength={120} required />
            </div>
            <div>
              <Label>Téléphone</Label>
              <input className={champ} type="tel" placeholder="77 123 45 67" value={f.telephone} onChange={maj("telephone")} required />
            </div>
            <div>
              <Label>Mot de passe provisoire ({MOT_DE_PASSE_MIN} caractères min.)</Label>
              <input className={champ} type="text" autoComplete="off" value={f.code} onChange={maj("code")} minLength={MOT_DE_PASSE_MIN} required />
            </div>
            <Bouton type="submit" disabled={isPending}>
              {isPending ? "Création…" : "Créer l'école"}
            </Bouton>
          </form>
        )}
      </Carte>
    </div>
  );
}
