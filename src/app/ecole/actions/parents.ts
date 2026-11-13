"use server";

import { revalidatePath } from "next/cache";
import { generateToken } from "@/lib/config";
import { messageErreur } from "@/lib/securite/erreurs";
import { SESSION_EXPIREE, session, type Resultat } from "./_commun";

export async function regenererLienParent(parentId: string): Promise<Resultat> {
  const s = await session();
  if (!s) return { success: false, message: SESSION_EXPIREE };
  const { error } = await s.supabase.from("parents").update({ token: generateToken() }).eq("id", parentId).eq("ecole_id", s.ecoleId);
  if (error) return { success: false, message: messageErreur("parents", error) };
  revalidatePath("/ecole");
  return { success: true, message: "Nouveau lien créé : l'ancien ne fonctionne plus." };
}
