import { cn } from "@/lib/utils";

export function Carte({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cn("bg-white rounded-3xl border border-neutral-100 shadow-sm p-5", className)} />;
}
