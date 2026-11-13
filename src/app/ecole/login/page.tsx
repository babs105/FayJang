"use client";

import { useActionState } from "react";
import Link from "next/link";
import { GraduationCap, Lock } from "lucide-react";
import { loginEcoleAction } from "@/app/ecole/actions/session";

export default function EcoleLoginPage() {
  const [state, formAction, isPending] = useActionState(loginEcoleAction, undefined);

  return (
    <div className="min-h-screen bg-neutral-50 px-4 py-10 max-w-sm mx-auto flex flex-col justify-center">
      <div className="bg-white rounded-3xl p-6 shadow-sm border border-neutral-100 space-y-5">
        <div className="text-center">
          <div className="w-14 h-14 bg-jang-600 text-white rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-md shadow-jang-600/20">
            <GraduationCap className="w-7 h-7" />
          </div>
          <h1 className="text-xl font-extrabold text-neutral-900">
            Espace École <span className="text-jang-600">FayJàng</span>
          </h1>
          <p className="text-xs text-neutral-500 mt-1">Connectez-vous avec votre e-mail et votre mot de passe.</p>
        </div>

        {state?.error && <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-2xl text-xs">{state.error}</div>}

        <form action={formAction} className="space-y-3">
          <div>
            <label className="block text-xs font-bold text-neutral-700 mb-1">E-mail</label>
            <input
              type="email"
              name="email"
              required
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              placeholder="ex: direction@ecole.sn"
              className="w-full text-xs px-3 py-2.5 rounded-xl border border-neutral-200 focus:outline-none focus:ring-2 focus:ring-jang-500"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-neutral-700 mb-1">Mot de passe</label>
            <input
              type="password"
              name="mot_de_passe"
              required
              autoComplete="current-password"
              className="w-full text-xs px-3 py-2.5 rounded-xl border border-neutral-200 focus:outline-none focus:ring-2 focus:ring-jang-500"
            />
          </div>
          <button
            type="submit"
            disabled={isPending}
            className="w-full py-2.5 bg-neutral-900 hover:bg-neutral-800 disabled:opacity-50 text-white font-bold text-xs rounded-xl transition flex items-center justify-center gap-1.5"
          >
            <Lock className="w-4 h-4" />
            {isPending ? "Connexion..." : "Se connecter"}
          </button>
        </form>

        <p className="text-center text-xs text-neutral-500">
          Pas encore de compte ?{" "}
          <Link href="/inscription" className="font-bold text-jang-700 hover:underline">Essai gratuit 30 jours</Link>
        </p>
        <p className="text-center">
          <Link href="/" className="text-[11px] text-neutral-400 hover:text-neutral-700">← Retour à l&apos;accueil</Link>
        </p>
      </div>
    </div>
  );
}
