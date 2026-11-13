import { cn } from "@/lib/utils";
import { Carte } from "./carte";

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
