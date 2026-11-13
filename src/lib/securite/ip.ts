import "server-only";
import { headers } from "next/headers";

/**
 * IP du visiteur, pour les compteurs d'échecs de connexion (v1.10 T13). Sur Vercel, x-vercel-forwarded-for
 * et x-forwarded-for sont posés par la plateforme (une valeur envoyée par le client est remplacée).
 * Renvoie null si aucune IP lisible : la fonction SQL range alors l'appel dans le compteur « inconnue ».
 * À revoir si un autre proxy (Cloudflare…) est placé devant Vercel, ou hors de Vercel : le premier élément
 * de x-forwarded-for serait alors celui du proxy, ou celui envoyé par le client.
 * v1.10 (T16) : une adresse IPv6 est ramenée à son bloc /64. Un abonné reçoit en général tout un /64 et
 * pourrait sinon changer d'adresse à chaque essai pour échapper aux compteurs.
 */
export async function ipVisiteur(): Promise<string | null> {
  const h = await headers();
  const brute =
    h.get("x-vercel-forwarded-for")?.split(",")[0] ||
    h.get("x-forwarded-for")?.split(",")[0] ||
    h.get("x-real-ip") ||
    "";
  const ip = brute.trim().toLowerCase();
  if (!/^[0-9a-f:.]{2,45}$/.test(ip)) return null;
  return ip.includes(":") ? blocIpv6(ip) : ip;
}

/** « 2001:db8:1:2:a:b:c:d » ou « 2001:db8:1:2::5 » → « 2001:db8:1:2:: » ; IPv4 mappée (« ::ffff:1.2.3.4 ») → IPv4 */
function blocIpv6(ip: string): string | null {
  const ipv4 = ip.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (ipv4) return ipv4[1];
  const morceaux = ip.split("::");
  if (morceaux.length > 2) return null;
  const tete = morceaux[0] ? morceaux[0].split(":") : [];
  const queue = morceaux.length === 2 && morceaux[1] ? morceaux[1].split(":") : [];
  const manquants = 8 - tete.length - queue.length;
  if (manquants < 0 || (morceaux.length === 1 && manquants !== 0)) return null;
  const groupes = [...tete, ...Array(manquants).fill("0"), ...queue];
  if (groupes.length !== 8 || groupes.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groupes.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":") + "::";
}
