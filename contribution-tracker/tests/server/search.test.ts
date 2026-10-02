import { describe, expect, it } from "vitest";
import { createInvoice, issueInvoice, recordPayment } from "@/server/finance";
import { search } from "@/server/search";
import { bootstrap } from "../fixtures";

describe("search", () => {
  it("finds projects, clients, invoices, payments and tasks", () => {
    const f = bootstrap();
    const { invoiceId } = createInvoice(f.at(f.a), f.projectId, { type: "advance", issueDate: "2026-10-01", dueDate: "2026-10-08", amountExGst: 3_000_000 });
    issueInvoice(f.at(f.a), invoiceId);
    recordPayment(f.at(f.a), invoiceId, { receivedDate: "2026-10-02", amountReceived: 3_540_000, tdsDeducted: 0, bankReference: "UTR778899", mode: "bank" });
    const kinds = (q: string) => search(f.db, f.a, q).map((h) => h.kind);
    expect(kinds("Sunrise")).toEqual(expect.arrayContaining(["project", "client"]));
    expect(search(f.db, f.a, "INV/26-27/001")[0]).toMatchObject({ kind: "invoice", href: expect.stringContaining("/invoice/") });
    expect(kinds("778899")).toEqual(["payment"]);
    expect(kinds("H-05")).toContain("task");
    expect(search(f.db, f.a, "x")).toEqual([]);
    expect(search(f.db, f.a, "%")).toEqual([]);
  });
});
