import { cn } from "@/lib/utils";

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
