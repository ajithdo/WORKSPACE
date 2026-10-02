import { describe, expect, it } from "vitest";
import { communicationAwards, communicationQualifies } from "@/domain/communication";

const discovery = { lead_points: 3, second_attendee_points: 2 };

describe("communication qualification", () => {
  const ok = { summary: "Agreed sitemap", decisions: ["6 pages"], actionItemCount: 0, evidenceTypes: ["meeting_notes_sent"] };
  it("needs summary, a decision or action, and notes or a record", () => {
    expect(communicationQualifies(ok)).toBe(true);
    expect(communicationQualifies({ ...ok, decisions: [], actionItemCount: 1 })).toBe(true);
    expect(communicationQualifies({ ...ok, decisions: [] })).toBe(false);
    expect(communicationQualifies({ ...ok, summary: "  " })).toBe(false);
    expect(communicationQualifies({ ...ok, evidenceTypes: ["screenshot"] })).toBe(false);
  });
});

describe("communication awards", () => {
  const base = { leadMemberId: 1, secondMemberId: 2, secondRequired: true, multiplier: 1, splitParties: null };
  it("lead and required second attendee", () => {
    expect(communicationAwards(base, discovery)).toEqual([
      { memberId: 1, points: 3 },
      { memberId: 2, points: 2 },
    ]);
  });
  it("second attendee not flagged at planning gets nothing", () => {
    expect(communicationAwards({ ...base, secondRequired: false }, discovery)).toEqual([{ memberId: 1, points: 3 }]);
  });
  it("lead cannot also be the second attendee", () => {
    expect(communicationAwards({ ...base, secondMemberId: 1 }, discovery)).toEqual([{ memberId: 1, points: 3 }]);
  });
  it("dispute outcomes halve or split the points", () => {
    expect(communicationAwards({ ...base, multiplier: 0.5 }, discovery)).toEqual([
      { memberId: 1, points: 1.5 },
      { memberId: 2, points: 1 },
    ]);
    expect(communicationAwards({ ...base, secondRequired: false, splitParties: [1, 2] }, discovery)).toEqual([
      { memberId: 1, points: 1.5 },
      { memberId: 2, points: 1.5 },
    ]);
  });
});
