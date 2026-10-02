import { describe, expect, it } from "vitest";
import { istLocalToIso, istNowLocal } from "@/lib/form";

describe("IST date-times", () => {
  it("reads a datetime-local value as India time whatever the server's timezone", () => {
    expect(istLocalToIso("2026-10-01T11:00")).toBe("2026-10-01T05:30:00.000Z");
    expect(istLocalToIso("2026-10-01T00:15:30")).toBe("2026-09-30T18:45:30.000Z");
    expect(() => istLocalToIso("yesterday")).toThrow(/date and time/);
  });
  it("renders now as an IST datetime-local default", () => {
    expect(istNowLocal(new Date("2026-10-01T20:00:00Z"))).toBe("2026-10-02T01:30");
  });
});

describe("India calendar date", () => {
  it("is already 1 April in India at 19:00 UTC on 31 March (new financial year)", async () => {
    const { isoDate } = await import("@/server/context");
    const { financialYearLabel } = await import("@/domain/money");
    const d = isoDate(new Date("2027-03-31T19:00:00Z"));
    expect(d).toBe("2027-04-01");
    expect(financialYearLabel(d)).toBe("27-28");
    expect(isoDate(new Date("2027-03-31T18:00:00Z"))).toBe("2027-03-31");
  });
});
