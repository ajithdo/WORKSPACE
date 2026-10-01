import { describe, expect, it } from "vitest";
import { canonicalJson, sha256Hex } from "@/domain/canonical";

describe("canonicalJson", () => {
  it("sorts object keys recursively and drops whitespace", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { z: 1, y: 2 }] } })).toBe(
      '{"a":{"c":[3,{"y":2,"z":1}],"d":2},"b":1}',
    );
  });

  it("omits undefined object values like JSON.stringify", () => {
    expect(canonicalJson({ a: undefined, b: null })).toBe('{"b":null}');
  });

  it("refuses non-finite numbers so hashes never depend on NaN", () => {
    expect(() => canonicalJson({ a: Number.NaN })).toThrow(/finite/);
    expect(() => canonicalJson([Infinity])).toThrow(/finite/);
  });

  it("is stable regardless of key insertion order", () => {
    expect(canonicalJson({ x: 1, y: 2 })).toBe(canonicalJson({ y: 2, x: 1 }));
  });
});

describe("sha256Hex", () => {
  it("matches the standard test vector", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
