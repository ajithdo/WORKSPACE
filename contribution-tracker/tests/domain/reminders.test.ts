import { describe, expect, it } from "vitest";
import { reminderMessage, reminderTone, whatsappNumber } from "@/domain/reminders";

const base = {
  studioName: "Demo Studio",
  clientName: "Sunrise Bakery",
  contactName: "Ravi",
  invoiceNumber: "INV/26-27/001",
  issueDate: "2026-09-01",
  dueDate: "2026-09-10",
  outstandingPaise: 3_540_000,
  msme: true,
  udyamNumber: "UDYAM-TS-00-0000000",
};

describe("reminders", () => {
  it("picks the tone by days overdue", () => {
    expect(reminderTone(3)).toBe("gentle");
    expect(reminderTone(8)).toBe("firm");
    expect(reminderTone(31)).toBe("final");
  });
  it("final reminder cites the MSME Act and Samadhaan", () => {
    const m = reminderMessage({ ...base, today: "2026-10-20" });
    expect(m.daysOverdue).toBe(40);
    expect(m.tone).toBe("final");
    expect(m.body).toContain("section 16 of the MSMED Act");
    expect(m.body).toContain("Samadhaan");
    expect(m.body).not.toMatch(/\n{3,}/);
    expect(m.subject).toContain("INV/26-27/001");
  });
  it("gentle reminder has no legal language", () => {
    const m = reminderMessage({ ...base, today: "2026-09-12" });
    expect(m.body).not.toContain("MSMED");
  });
  it("normalises WhatsApp numbers", () => {
    expect(whatsappNumber("098765 43210")).toBe("919876543210");
    expect(whatsappNumber("+91 98765-43210")).toBe("919876543210");
    expect(whatsappNumber("123")).toBeNull();
  });
});

describe("reminder dates", () => {
  it("prints readable dates", () => {
    expect(reminderMessage({ ...base, today: "2026-09-12" }).body).toMatch(/dated 1 Sept? 2026/);
  });
});
