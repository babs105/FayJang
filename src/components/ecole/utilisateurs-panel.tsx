"use client";

import { useState, useTransition } from "react";
import { Badge, Bouton, Carte, Message, champ } from "@/components/ui";
import { MOT_DE_PASSE_MIN } from "@/lib/mot-de-passe";
import { lireSaisieCaissier } from "@/lib/utilisateurs";
import { changerStatutUtilisateur, creerCaissier, reinitialiserMotDePasseUtilisateur } from "@/app/ecole/actions/utilisateurs";
import type { UtilisateurListeVue } from "@/app/ecole/types";

/**
 * Comptes de l'école, pour le directeur (D09, tranche 3) : ajouter un caissier, le désactiver ou le réactiver,
 * réinitialiser son mot de passe. Le directeur lui-même n'est ni désactivé ni réinitialisé ici (/admin).
 * En lecture seule (abonnement), seule la création est fermée : la base la refuse aussi.
 */
export function UtilisateursPanel({ utilisateurs, lectureSeule }: { utilisateurs: UtilisateurListeVue[]; lectureSeule: boolean }) {
  const [nouveau, setNouveau] = useState({ nom: "", email: "", motDePasse: "" });
  const [reinit, setReinit] = useState<{ id: string; motDePasse: string } | null>(null);
  const [retour, setRetour] = useState<{ ok: boolean; texte: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  function executer(action: () => Promise<{ success: boolean; message?: string }>, apres?: () => void) {
    setRetour(null);
    startTransition(async () => {
      const r = await action();
      setRetour({ ok: r.success, texte: r.message ?? (r.success ? "Enregistré." : "Opération impossible.") });
      if (r.success) apres?.();
    });
  }

  const saisieValide = typeof lireSaisieCaissier(nouveau) !== "string";

  return (
    <Carte className="space-y-3">
      <h3 className="text-sm font-extrabold">Utilisateurs</h3>
      {retour && <Message ok={retour.ok}>{retour.texte}</Message>}

      <ul className="divide-y divide-neutral-100">
        {utilisateurs.map((u) => (
          <li key={u.id} className="py-2 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-bold text-neutral-900 truncate">{u.nom}</p>
                <p className="text-[11px] text-neutral-500 truncate">{u.email}</p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Badge ton={u.role === "directeur" ? "bleu" : "vert"}>{u.role === "directeur" ? "Directeur" : "Caissier"}</Badge>
                {!u.actif && <Badge ton="gris">Désactivé</Badge>}
              </div>
            </div>
            {u.role === "caissier" && (
              <div className="flex flex-wrap gap-1.5">
                <Bouton
                  variante={u.actif ? "danger" : "secondaire"}
                  disabled={isPending}
                  className="!py-1 !px-2.5 text-[11px]"
                  onClick={() => {
                    if (u.actif && !confirm(`Désactiver ${u.nom} ? Sa session est coupée et il ne peut plus se connecter.`)) return;
                    executer(() => changerStatutUtilisateur(u.id, !u.actif));
                  }}
                >
                  {u.actif ? "Désactiver" : "Réactiver"}
                </Bouton>
                <Bouton
                  variante="secondaire"
                  disabled={isPending}
                  className="!py-1 !px-2.5 text-[11px]"
                  onClick={() => setReinit(reinit?.id === u.id ? null : { id: u.id, motDePasse: "" })}
                >
                  Réinitialiser le mot de passe
                </Bouton>
              </div>
            )}
            {reinit?.id === u.id && (
              <form
                className="flex gap-1.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  executer(() => reinitialiserMotDePasseUtilisateur(u.id, reinit.motDePasse), () => setReinit(null));
                }}
              >
                <input
                  type="password"
                  autoComplete="new-password"
                  placeholder={`Nouveau mot de passe (${MOT_DE_PASSE_MIN} min.)`}
                  value={reinit.motDePasse}
                  onChange={(e) => setReinit({ id: u.id, motDePasse: e.target.value })}
                  className={champ}
                />
                <Bouton type="submit" variante="sombre" disabled={isPending || reinit.motDePasse.trim().length < MOT_DE_PASSE_MIN}>
                  Valider
                </Bouton>
              </form>
            )}
          </li>
        ))}
      </ul>

      {lectureSeule ? (
        <p className="text-[11px] text-neutral-500">Abonnement en lecture seule : l'ajout d'un caissier est fermé.</p>
      ) : (
        <form
          className="space-y-2 pt-2 border-t border-neutral-100"
          onSubmit={(e) => {
            e.preventDefault();
            executer(() => creerCaissier(nouveau), () => setNouveau({ nom: "", email: "", motDePasse: "" }));
          }}
        >
          <p className="text-xs font-bold text-neutral-700">Ajouter un caissier</p>
          <input placeholder="Nom (ex : Moussa Ndiaye)" value={nouveau.nom} onChange={(e) => setNouveau({ ...nouveau, nom: e.target.value })} className={champ} />
          <input type="email" autoComplete="off" placeholder="E-mail de connexion" value={nouveau.email} onChange={(e) => setNouveau({ ...nouveau, email: e.target.value })} className={champ} />
          <input
            type="password"
            autoComplete="new-password"
            placeholder={`Mot de passe provisoire (${MOT_DE_PASSE_MIN} caractères min.)`}
            value={nouveau.motDePasse}
            onChange={(e) => setNouveau({ ...nouveau, motDePasse: e.target.value })}
            className={champ}
          />
          <Bouton type="submit" disabled={isPending || !saisieValide} className="w-full">Créer le caissier</Bouton>
        </form>
      )}
    </Carte>
  );
}
