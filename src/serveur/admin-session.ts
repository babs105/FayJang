import "server-only";
import { cookies } from "next/headers";
import { hashCode, safeEqual, sign } from "@/serveur/ecole-session";

const COOKIE_NAME = "fayjang_admin";
const SESSION_DURATION_SECONDS = 60 * 60 * 12; // 12 heures

/** Console SuperAdmin : accès par le code secret SUPERADMIN_CODE (variable d'environnement) */
export function isAdminConfigure(): boolean {
  return (process.env.SUPERADMIN_CODE || "").trim().length >= 12;
}

export function verifyAdminCode(code: string): boolean {
  if (!isAdminConfigure()) return false;
  return safeEqual(hashCode(code), hashCode(process.env.SUPERADMIN_CODE!));
}

export async function createAdminSession(): Promise<void> {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_DURATION_SECONDS;
  const payload = `superadmin.${expiresAt}`;
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/admin",
    maxAge: SESSION_DURATION_SECONDS,
  });
}

export async function destroyAdminSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete({ name: COOKIE_NAME, path: "/admin" });
}

export async function isAdmin(): Promise<boolean> {
  if (!isAdminConfigure()) return false;
  const cookieStore = await cookies();
  const value = cookieStore.get(COOKIE_NAME)?.value;
  if (!value) return false;
  const [role, expiresAt, signature] = value.split(".");
  if (role !== "superadmin" || !expiresAt || !signature) return false;
  if (!safeEqual(sign(`${role}.${expiresAt}`), signature)) return false;
  return Number(expiresAt) >= Math.floor(Date.now() / 1000);
}
