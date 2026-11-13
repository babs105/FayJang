import { cn } from "@/lib/utils";

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
