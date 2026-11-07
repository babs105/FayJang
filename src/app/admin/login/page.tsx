"use client";

import { useActionState } from "react";
import { ShieldCheck } from "lucide-react";
import { loginAdminAction } from "../actions";

export default function AdminLoginPage() {
  const [state, formAction, isPending] = useActionState(loginAdminAction, undefined);
  return (
    <div className="min-h-screen bg-neutral-900 px-4 flex items-center justify-center">
      <form action={formAction} className="bg-white rounded-3xl p-6 w-full max-w-xs space-y-4">
        <div className="text-center">
          <ShieldCheck className="w-8 h-8 mx-auto text-jang-600" />
          <h1 className="text-sm font-extrabold mt-2">Console JàngPay</h1>
        </div>
        {state?.error && <p className="text-xs text-red-600 text-center">{state.error}</p>}
        <input name="code" type="password" required autoComplete="current-password" placeholder="Code SuperAdmin" className="w-full text-xs px-3 py-2.5 rounded-xl border border-neutral-200" />
        <button disabled={isPending} className="w-full py-2.5 bg-neutral-900 text-white text-xs font-bold rounded-xl disabled:opacity-50">
          {isPending ? "..." : "Entrer"}
        </button>
      </form>
    </div>
  );
}
