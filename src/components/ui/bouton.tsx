import { cn } from "@/lib/utils";

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
