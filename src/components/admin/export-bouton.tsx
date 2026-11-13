"use client";

import { useState, useTransition } from "react";
import { Download } from "lucide-react";
import { Bouton } from "@/components/ui";
import { exportAdmin } from "@/app/admin/actions/stats";

/** Télécharge l'export Excel de toutes les écoles */
export function ExportBouton() {
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  return (
    <div className="flex items-center gap-2">
      <Bouton
        variante="secondaire"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const r = await exportAdmin();
            if (!r.success || !r.data) return setMessage(r.message ?? "Export impossible.");
            setMessage(null);
            const octets = Uint8Array.from(atob(r.data.base64), (c) => c.charCodeAt(0));
            const url = URL.createObjectURL(new Blob([octets], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
            const a = document.createElement("a");
            a.href = url;
            a.download = r.data.nom;
            a.click();
            URL.revokeObjectURL(url);
          })
        }
      >
        <Download className="w-4 h-4" /> {isPending ? "Export…" : "Exporter (Excel)"}
      </Bouton>
      {message && <span className="text-[11px] text-red-700">{message}</span>}
    </div>
  );
}
