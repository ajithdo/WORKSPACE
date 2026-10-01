import { describe, expect, it } from "vitest";
import { addMember, changePassword, login, logout, memberForSession, setupStudio } from "@/server/auth";
import { ctxFor, T0, testDb } from "../helpers";

const later = (ms: number) => new Date(T0.getTime() + ms);

function setup() {
  const db = testDb();
  const { memberIds } = setupStudio(db, T0, {
    studio: { name: "Studio", stateCode: "36", gstRegistered: false, msmeRegistered: false },
    members: [
      { name: "Asha", email: "Asha@Studio.test", password: "correct horse battery", roles: ["FE"] },
      { name: "Bala", email: "bala@studio.test", password: "correct horse staple", roles: ["BE"] },
    ],
  });
  return { db, a: memberIds[0] as number };
}

describe("setup and login", () => {
  it("runs once and imports the library", () => {
    const { db } = setup();
    expect(() => setupStudio(db, T0, { studio: { name: "x", stateCode: "36", gstRegistered: false, msmeRegistered: false }, members: [] })).toThrow(/already set up/);
  });

  it("logs in case-insensitively and resolves the session", () => {
    const { db, a } = setup();
    const s = login(db, T0, { email: "asha@studio.TEST", password: "correct horse battery", ip: "1.1.1.1" });
    expect(memberForSession(db, later(1000), s.token)?.id).toBe(a);
    logout(db, s.token);
    expect(memberForSession(db, later(2000), s.token)).toBeNull();
  });

  it("rejects wrong passwords without saying which part was wrong", () => {
    const { db } = setup();
    expect(() => login(db, T0, { email: "asha@studio.test", password: "nope nope nope", ip: "1.1.1.2" })).toThrow(/Wrong email or password/);
    expect(() => login(db, T0, { email: "nobody@studio.test", password: "nope nope nope", ip: "1.1.1.2" })).toThrow(/Wrong email or password/);
  });

  it("throttles repeated failures", () => {
    const { db } = setup();
    for (let i = 0; i < 5; i++) expect(() => login(db, T0, { email: "bala@studio.test", password: "wrong password!", ip: "9.9.9.9" })).toThrow();
    expect(() => login(db, later(1000), { email: "bala@studio.test", password: "correct horse staple", ip: "9.9.9.9" })).toThrow(/Too many/);
    expect(login(db, later(16 * 60_000), { email: "bala@studio.test", password: "correct horse staple", ip: "9.9.9.9" }).token).toBeTruthy();
  });

  it("expires sessions after 30 days", () => {
    const { db } = setup();
    const s = login(db, T0, { email: "asha@studio.test", password: "correct horse battery", ip: "1.1.1.3" });
    expect(memberForSession(db, later(31 * 86_400_000), s.token)).toBeNull();
  });

  it("enforces password length and checks the current password", () => {
    const { db, a } = setup();
    expect(() => changePassword(ctxFor(db, a), { current: "correct horse battery", next: "short" })).toThrow(/at least 10/);
    expect(() => changePassword(ctxFor(db, a), { current: "wrong one!!", next: "a much longer password" })).toThrow(/Current password/);
    changePassword(ctxFor(db, a), { current: "correct horse battery", next: "a much longer password" });
    expect(login(db, T0, { email: "asha@studio.test", password: "a much longer password", ip: "1.1.1.4" }).token).toBeTruthy();
  });

  it("adds a member with a unique email", () => {
    const { db, a } = setup();
    addMember(ctxFor(db, a), { name: "Chitra", email: "chitra@studio.test", password: "temporary password 1", roles: ["QA"] });
    expect(() => addMember(ctxFor(db, a), { name: "Dup", email: "CHITRA@studio.test", password: "temporary password 1", roles: [] })).toThrow(/already/);
  });
});
