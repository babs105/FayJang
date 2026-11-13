"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/utils";

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
