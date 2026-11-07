"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const champ =
  "w-full text-xs px-3 py-2.5 rounded-xl border border-neutral-200 bg-white focus:outline-none focus:ring-2 focus:ring-jang-500";

export function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-xs font-bold text-neutral-700 mb-1">{children}</label>;
}

export function Bouton({
  variante = "principal",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variante?: "principal" | "secondaire" | "danger" | "sombre" }) {
  return (
    <button
      {...props}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs font-bold transition active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none",
        variante === "principal" && "bg-jang-600 hover:bg-jang-700 text-white",
        variante === "sombre" && "bg-neutral-900 hover:bg-neutral-800 text-white",
        variante === "secondaire" && "bg-white border border-neutral-200 hover:bg-neutral-50 text-neutral-800",
        variante === "danger" && "bg-red-50 border border-red-200 hover:bg-red-100 text-red-700",
        className
      )}
    />
  );
}

export function Carte({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cn("bg-white rounded-3xl border border-neutral-100 shadow-sm p-5", className)} />;
}

export function Badge({ ton, children }: { ton: "vert" | "orange" | "rouge" | "gris" | "bleu"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold whitespace-nowrap",
        ton === "vert" && "bg-jang-50 text-jang-700",
        ton === "orange" && "bg-amber-50 text-amber-700",
        ton === "rouge" && "bg-red-50 text-red-700",
        ton === "gris" && "bg-neutral-100 text-neutral-600",
        ton === "bleu" && "bg-sky-50 text-sky-700"
      )}
    >
      {children}
    </span>
  );
}

export function Modal({
  titre,
  onClose,
  children,
  large,
}: {
  titre: string;
  onClose: () => void;
  children: React.ReactNode;
  large?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div
        className={cn(
          "bg-white w-full rounded-t-3xl sm:rounded-3xl max-h-[92vh] overflow-y-auto shadow-xl",
          large ? "sm:max-w-3xl" : "sm:max-w-md"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white/95 backdrop-blur px-5 py-4 border-b border-neutral-100 flex items-center justify-between">
          <h2 className="text-sm font-extrabold text-neutral-900">{titre}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-neutral-100" aria-label="Fermer">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Message({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "p-3 rounded-2xl text-xs border",
        ok ? "bg-jang-50 border-jang-100 text-jang-700" : "bg-red-50 border-red-200 text-red-700"
      )}
    >
      {children}
    </div>
  );
}

export function Kpi({ label, valeur, detail, ton }: { label: string; valeur: string; detail?: string; ton?: "vert" | "rouge" }) {
  return (
    <Carte className="p-4">
      <p className="text-[11px] font-bold uppercase tracking-wide text-neutral-500">{label}</p>
      <p className={cn("text-xl font-extrabold mt-1", ton === "vert" ? "text-jang-700" : ton === "rouge" ? "text-red-600" : "text-neutral-900")}>
        {valeur}
      </p>
      {detail && <p className="text-[11px] text-neutral-500 mt-0.5">{detail}</p>}
    </Carte>
  );
}
