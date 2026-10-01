import { describe, expect, it } from "vitest";
import {
  financialYearLabel,
  formatINR,
  formatInvoiceNumber,
  msmeDueDate,
  parseRupeesToPaise,
  paymentRevenue,
  splitGst,
  toPaise,
  tdsAmount,
} from "@/domain/money";

describe("paise conversion", () => {
  it("converts rupees to integer paise without float drift", () => {
    expect(toPaise(60000)).toBe(6_000_000);
    expect(toPaise(0.1 + 0.2)).toBe(30);
  });

  it("parses user-typed rupee strings with Indian grouping", () => {
    expect(parseRupeesToPaise("1,18,000.50")).toBe(11_800_050);
    expect(parseRupeesToPaise(" 250 ")).toBe(25_000);
    expect(parseRupeesToPaise("12.345")).toBeNull();
    expect(parseRupeesToPaise("abc")).toBeNull();
    expect(parseRupeesToPaise("-5")).toBeNull();
  });

  it("formats with Indian digit grouping", () => {
    expect(formatINR(2_783_500)).toBe("₹27,835.00");
    expect(formatINR(12_345_678_900)).toBe("₹12,34,56,789.00");
    expect(formatINR(-50)).toBe("-₹0.50");
  });
});

describe("GST", () => {
  it("splits intra-state supply into CGST and SGST", () => {
    expect(splitGst(10_000_000, 1800, true)).toEqual({ cgst: 900_000, sgst: 900_000, igst: 0, gstTotal: 1_800_000, total: 11_800_000 });
  });

  it("charges IGST on inter-state supply", () => {
    expect(splitGst(10_000_000, 1800, false)).toEqual({ cgst: 0, sgst: 0, igst: 1_800_000, gstTotal: 1_800_000, total: 11_800_000 });
  });

  it("rounds each component to the paisa", () => {
    expect(splitGst(105, 1800, true)).toEqual({ cgst: 9, sgst: 9, igst: 0, gstTotal: 18, total: 123 });
  });

  it("charges nothing when not GST registered (rate 0)", () => {
    expect(splitGst(5000, 0, true)).toEqual({ cgst: 0, sgst: 0, igst: 0, gstTotal: 0, total: 5000 });
  });
});

describe("payment revenue", () => {
  const invoice = { total: 11_800_000, gstTotal: 1_800_000 };

  it("removes GST pro rata and keeps TDS as a receivable", () => {
    expect(paymentRevenue({ amountReceived: 10_800_000, tdsDeducted: 1_000_000 }, invoice)).toEqual({
      grossSettled: 11_800_000,
      gstComponent: 1_800_000,
      revenueExGst: 9_000_000,
    });
  });

  it("partial payment with TDS", () => {
    expect(paymentRevenue({ amountReceived: 5_400_000, tdsDeducted: 500_000 }, invoice)).toEqual({
      grossSettled: 5_900_000,
      gstComponent: 900_000,
      revenueExGst: 4_500_000,
    });
  });

  it("handles invoices without GST", () => {
    expect(paymentRevenue({ amountReceived: 100_000, tdsDeducted: 0 }, { total: 100_000, gstTotal: 0 })).toEqual({
      grossSettled: 100_000,
      gstComponent: 0,
      revenueExGst: 100_000,
    });
  });

  it("computes expected TDS on the amount before GST", () => {
    expect(tdsAmount(10_000_000, 1000)).toBe(1_000_000);
    expect(tdsAmount(10_000_000, 200)).toBe(200_000);
  });
});

describe("MSME and invoice numbering", () => {
  it("MSME due is min(agreed, acceptance+45)", () => {
    expect(msmeDueDate("2026-12-31", "2026-10-01", 45)).toBe("2026-11-15");
    expect(msmeDueDate("2026-10-20", "2026-10-01", 45)).toBe("2026-10-20");
  });

  it("FY label runs April to March", () => {
    expect(financialYearLabel("2026-03-31")).toBe("25-26");
    expect(financialYearLabel("2026-04-01")).toBe("26-27");
    expect(financialYearLabel("2027-01-15")).toBe("26-27");
  });

  it("formats invoice numbers within the 16-character GST limit", () => {
    expect(formatInvoiceNumber("INV", "26-27", 7)).toBe("INV/26-27/007");
    expect(formatInvoiceNumber("INV", "26-27", 1234)).toBe("INV/26-27/1234");
    expect(() => formatInvoiceNumber("STUDIOINVOICE", "26-27", 1)).toThrow(/16/);
  });
});
