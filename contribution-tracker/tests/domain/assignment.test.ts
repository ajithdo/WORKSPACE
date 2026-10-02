import { describe, expect, it } from "vitest";
import { suggestAssignments } from "@/domain/assignment";

const members = [
  { id: 1, roles: ["FE", "Design"] },
  { id: 2, roles: ["BE", "PM", "Sales"] },
];

describe("owner suggestions", () => {
  it("assigns by the first matching role", () => {
    const out = suggestAssignments([{ code: "V-01", defaultOwnerRole: "FE", points: 3 }, { code: "W-01", defaultOwnerRole: "BE", points: 2 }], members);
    expect(out.get("V-01")).toEqual({ ownerMemberId: 1, sharesBp: { 1: 10000 } });
    expect(out.get("W-01")).toEqual({ ownerMemberId: 2, sharesBp: { 2: 10000 } });
  });

  it("balances 'Either' and unmatched roles towards the member with fewer points", () => {
    const out = suggestAssignments(
      [
        { code: "V-01", defaultOwnerRole: "FE", points: 10 },
        { code: "I-06", defaultOwnerRole: "Either", points: 1 },
        { code: "AP-02", defaultOwnerRole: "QA", points: 5 },
      ],
      members,
    );
    expect(out.get("I-06")?.ownerMemberId).toBe(2);
    expect(out.get("AP-02")?.ownerMemberId).toBe(2);
  });

  it("splits '(both)' tasks equally", () => {
    const out = suggestAssignments([{ code: "BJ-01", defaultOwnerRole: "Either (both)", points: 1 }], members);
    expect(out.get("BJ-01")).toEqual({ ownerMemberId: 1, sharesBp: { 1: 5000, 2: 5000 } });
  });

  it("splits basis points exactly across three members", () => {
    const three = [...members, { id: 3, roles: ["QA"] }];
    const out = suggestAssignments([{ code: "BJ-01", defaultOwnerRole: "Either (both)", points: 1 }], three);
    expect(out.get("BJ-01")?.sharesBp).toEqual({ 1: 3334, 2: 3333, 3: 3333 });
  });

  it("skips the Client role and uses the studio role", () => {
    const out = suggestAssignments([{ code: "BG-01", defaultOwnerRole: "PM + Client", points: 1 }], members);
    expect(out.get("BG-01")?.ownerMemberId).toBe(2);
  });
});
