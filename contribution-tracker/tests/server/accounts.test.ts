import { describe, expect, it } from "vitest";
import { accountYears, csvCell, invoicesCsv, paymentsCsv } from "@/server/accounts";
import { createInvoice, issueInvoice, recordPayment } from "@/server/finance";
import { bootstrap } from "../fixtures";

describe("accountant export", () => {
  it("neutralises formulas and quotes commas", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("Rao, Asha")).toBe('"Rao, Asha"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell(12.5)).toBe("12.5");
  });

  it("lists issued invoices and payments of the financial year only", () => {
    const f = bootstrap();
    const { invoiceId } = createInvoice(f.at(f.a), f.projectId, { type: "advance", issueDate: "2026-10-01", dueDate: "2026-10-08", amountExGst: 3_000_000, tdsExpectedRateBp: 1000 });
    issueInvoice(f.at(f.a), invoiceId);
    createInvoice(f.at(f.a), f.projectId, { type: "milestone", issueDate: "2026-10-02", dueDate: "2026-10-09", amountExGst: 1_000_000 }); // draft: excluded
    recordPayment(f.at(f.a), invoiceId, { receivedDate: "2026-10-05", amountReceived: 3_240_000, tdsDeducted: 300_000, bankReference: "UTR998", mode: "bank" });

    expect(accountYears(f.db)).toEqual(["26-27"]);
    const inv = invoicesCsv(f.db, "26-27").trim().split("\r\n");
    expect(inv).toHaveLength(2);
    expect(inv[1]).toContain("INV/26-27/001");
    expect(inv[1]).toContain("30000.00,18,2700.00,2700.00,0.00,35400.00");
    expect(invoicesCsv(f.db, "25-26").trim().split("\r\n")).toHaveLength(1);

    const pay = paymentsCsv(f.db, "26-27").trim().split("\r\n");
    expect(pay).toHaveLength(2);
    expect(pay[1]).toContain("2026-10-05,INV/26-27/001,Sunrise Bakery");
    expect(pay[1]).toContain("32400.00,3000.00");
  });
});
