import Link from "next/link";
import { BellRing, FileText, GraduationCap, Smartphone, Users, Wallet } from "lucide-react";

const ATOUTS = [
  { icone: Users, titre: "Inscriptions en 1 minute", texte: "Élève, parent, classe et frais d'inscription encaissés dans le même écran. Matricule attribué automatiquement." },
  { icone: Wallet, titre: "Mensualités suivies mois par mois", texte: "Payé, partiel, en retard : chaque mois est visible d'un coup d'œil, réductions et fratries comprises." },
  { icone: Smartphone, titre: "Wave, Orange Money, espèces", texte: "Chaque paiement garde son mode et sa référence de transaction. Plus de cahier à recompter." },
  { icone: FileText, titre: "Reçus numérotés en PDF", texte: "Un reçu officiel par paiement, téléchargeable par l'école et par le parent. Annulation tracée." },
  { icone: BellRing, titre: "Relances WhatsApp", texte: "La liste des impayés et un message prêt à envoyer au parent, avec son lien de suivi." },
  { icone: GraduationCap, titre: "Espace parent", texte: "Chaque parent suit la scolarité de ses enfants depuis son téléphone, sans mot de passe." },
];

export default function Accueil() {
  return (
    <div className="min-h-screen bg-white">
      <header className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
        <p className="text-lg font-extrabold">
          Fay<span className="text-jang-600">Jàng</span>
        </p>
        <Link href="/ecole/login" className="text-xs font-bold text-neutral-700 hover:text-neutral-900">Espace École</Link>
      </header>

      <section className="max-w-6xl mx-auto px-4 pt-10 pb-16 text-center">
        <p className="inline-block px-3 py-1 rounded-full bg-jang-50 text-jang-700 text-[11px] font-bold mb-4">Pour les écoles privées du Sénégal</p>
        <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-neutral-900 max-w-3xl mx-auto">
          La scolarité de vos élèves, <span className="text-jang-600">payée et suivie</span> sans cahier.
        </h1>
        <p className="mt-4 text-sm text-neutral-600 max-w-xl mx-auto">
          Inscriptions, mensualités, paiements mobile money, reçus et relances : tout le suivi financier de votre école dans une seule application.
        </p>
        <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
          <Link href="/inscription" className="px-6 py-3 rounded-2xl bg-jang-600 hover:bg-jang-700 text-white text-sm font-bold">Essai gratuit 30 jours</Link>
          <Link href="/ecole/login" className="px-6 py-3 rounded-2xl border border-neutral-200 text-sm font-bold text-neutral-800 hover:bg-neutral-50">Se connecter</Link>
        </div>
      </section>

      <section className="bg-neutral-50 py-14">
        <div className="max-w-6xl mx-auto px-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {ATOUTS.map(({ icone: Icone, titre, texte }) => (
            <div key={titre} className="bg-white rounded-3xl p-5 border border-neutral-100">
              <Icone className="w-6 h-6 text-jang-600" />
              <h2 className="text-sm font-extrabold mt-3">{titre}</h2>
              <p className="text-xs text-neutral-600 mt-1 leading-relaxed">{texte}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="text-center text-[11px] text-neutral-400 py-8">FayJàng · « fay » : payer, « jàng » : étudier, en wolof</footer>
    </div>
  );
}
