"use client";

import { useActionState } from "react";
import Link from "next/link";
import { GraduationCap } from "lucide-react";
import { inscrireEcoleAction } from "./actions";

const champ = "w-full text-xs px-3 py-2.5 rounded-xl border border-neutral-200 focus:outline-none focus:ring-2 focus:ring-jang-500";

export default function InscriptionPage() {
  const [state, formAction, isPending] = useActionState(inscrireEcoleAction, undefined);

  return (
    <div className="min-h-screen bg-neutral-50 px-4 py-10 max-w-md mx-auto flex flex-col justify-center">
      <div className="bg-white rounded-3xl p-6 shadow-sm border border-neutral-100 space-y-5">
        <div className="text-center">
          <div className="w-14 h-14 bg-jang-600 text-white rounded-2xl flex items-center justify-center mx-auto mb-3">
            <GraduationCap className="w-7 h-7" />
          </div>
          <h1 className="text-xl font-extrabold">Ouvrir le compte de votre école</h1>
          <p className="text-xs text-neutral-500 mt-1">30 jours d&apos;essai gratuit, sans engagement.</p>
        </div>

        {state?.error && <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-2xl text-xs">{state.error}</div>}

        <form action={formAction} className="space-y-3">
          <input name="site" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
          <div>
            <label className="block text-xs font-bold text-neutral-700 mb-1">Nom de l&apos;école</label>
            <input name="nom" required placeholder="Groupe scolaire Les Pédagogues" className={champ} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-neutral-700 mb-1">Ville</label>
              <input name="ville" placeholder="Dakar" className={champ} />
            </div>
            <div>
              <label className="block text-xs font-bold text-neutral-700 mb-1">Responsable</label>
              <input name="responsable" required placeholder="M. Ndiaye" className={champ} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-neutral-700 mb-1">E-mail</label>
              <input name="email" type="email" required className={champ} />
            </div>
            <div>
              <label className="block text-xs font-bold text-neutral-700 mb-1">Téléphone</label>
              <input name="telephone" type="tel" required placeholder="77 123 45 67" className={champ} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-neutral-700 mb-1">Code d&apos;accès (8 caractères min.)</label>
            <input name="code" type="password" required minLength={8} autoComplete="new-password" className={champ} />
          </div>
          <button type="submit" disabled={isPending} className="w-full py-2.5 bg-jang-600 hover:bg-jang-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl">
            {isPending ? "Création..." : "Créer mon compte école"}
          </button>
        </form>
        <p className="text-center text-xs text-neutral-500">
          Déjà inscrit ? <Link href="/ecole/login" className="font-bold text-jang-700">Se connecter</Link>
        </p>
      </div>
    </div>
  );
}
