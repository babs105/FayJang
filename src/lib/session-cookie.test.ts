import { describe, expect, it } from "vitest";
import { lireCookieSession, payloadSession } from "./session-cookie";

const ID = "3f2b8c1e-7a4d-4e5f-9b6a-1c2d3e4f5a6b";
// Signature factice : la vraie (HMAC) est dans ecole-session.ts
const signer = (payload: string) => `sig-${payload.replace(/\./g, "_")}`;
const valide = (payload: string, signature: string) => signer(payload) === signature;
const cookie = (id: string, emis: number, expire: number) => `${payloadSession(id, emis, expire)}.${signer(payloadSession(id, emis, expire))}`;

describe("lireCookieSession", () => {
  it("accepte un cookie bien formé, signé et non expiré", () => {
    expect(lireCookieSession(cookie(ID, 1000, 5000), valide, 2000)).toEqual({ utilisateurId: ID, emisAt: 1000, expiresAt: 5000 });
  });

  it("refuse une signature altérée", () => {
    expect(lireCookieSession(`${payloadSession(ID, 1000, 5000)}.autre`, valide, 2000)).toBeNull();
  });

  it("refuse une date d'expiration modifiée (la signature ne correspond plus)", () => {
    const signe = cookie(ID, 1000, 5000);
    expect(lireCookieSession(signe.replace(".5000.", ".9000."), valide, 2000)).toBeNull();
  });

  it("refuse un cookie expiré", () => {
    expect(lireCookieSession(cookie(ID, 1000, 5000), valide, 5001)).toBeNull();
  });

  it("refuse un identifiant qui n'est pas un uuid", () => {
    expect(lireCookieSession(cookie("ecole-laf", 1000, 5000), valide, 2000)).toBeNull();
  });

  it("refuse les champs manquants ou en trop, et l'absence de cookie", () => {
    expect(lireCookieSession(undefined, valide, 2000)).toBeNull();
    expect(lireCookieSession("", valide, 2000)).toBeNull();
    expect(lireCookieSession(`${ID}.1000.5000`, valide, 2000)).toBeNull();
    expect(lireCookieSession(`${cookie(ID, 1000, 5000)}.x`, valide, 2000)).toBeNull();
    expect(lireCookieSession(`${ID}.abc.5000.sig`, valide, 2000)).toBeNull();
  });
});
