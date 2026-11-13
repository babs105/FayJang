import Link from "next/link";
import { LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { logoutAdminAction } from "@/app/admin/actions/session";

const LIENS = [
  { href: "/admin", cle: "tableau", libelle: "Tableau de bord" },
  { href: "/admin/ecoles", cle: "ecoles", libelle: "Écoles" },
  { href: "/admin/abonnements", cle: "abonnements", libelle: "Abonnements" },
] as const;

export type PageAdmin = (typeof LIENS)[number]["cle"];

/** En-tête commun des pages de la console : navigation et déconnexion */
export function EnteteAdmin({ actif }: { actif: PageAdmin }) {
  return (
    <header className="bg-neutral-900 text-white">
      <div className="max-w-6xl mx-auto px-4 py-3 flex justify-between items-center gap-3">
        <p className="text-sm font-extrabold">Console FayJàng</p>
        <form action={logoutAdminAction}>
          <button className="text-xs flex items-center gap-1 opacity-80 hover:opacity-100">
            <LogOut className="w-4 h-4" /> Quitter
          </button>
        </form>
      </div>
      <nav className="max-w-6xl mx-auto px-4 flex gap-1 overflow-x-auto">
        {LIENS.map((l) => (
          <Link
            key={l.cle}
            href={l.href}
            className={cn(
              "text-xs font-bold px-3 py-2 rounded-t-xl whitespace-nowrap",
              l.cle === actif ? "bg-neutral-50 text-neutral-900" : "text-neutral-300 hover:text-white"
            )}
          >
            {l.libelle}
          </Link>
        ))}
      </nav>
    </header>
  );
}

/** Bandeau quand les totaux (élèves, encaissé) n'ont pas pu être lus en entier */
export function AlerteTotaux() {
  return (
    <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-2xl p-3">
      Les totaux (élèves, encaissé) n&apos;ont pas pu être lus : ils sont affichés à zéro. Rechargez la page.
    </p>
  );
}

/** Message d'échec de lecture, à la place du contenu de la page */
export function ErreurLecture({ message }: { message?: string }) {
  return <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-2xl p-3">{message ?? "Lecture impossible, rechargez la page."}</p>;
}
