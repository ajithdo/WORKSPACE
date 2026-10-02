import { describe, expect, it } from "vitest";
import { findSecrets } from "@/domain/secrets";

const kinds = (s: string) => findSecrets(s).map((h) => h.kind);

describe("secret guard", () => {
  it("detects cloud and API keys", () => {
    expect(kinds("key AKIAIOSFODNN7EXAMPLE here")).toContain("aws_access_key");
    expect(kinds("ghp_" + "a".repeat(36))).toContain("github_token");
    expect(kinds("sk_live_" + "4eC39HqLyjWDarjtT1zdp7dc")).toContain("stripe_secret");
    expect(kinds("AIza" + "S".repeat(35))).toContain("google_api_key");
    expect(kinds("sk-ant-api03-" + "x".repeat(40))).toContain("ai_api_key");
  });

  it("detects private keys and JWTs", () => {
    expect(kinds("-----BEGIN RSA PRIVATE KEY-----\nMIIE")).toContain("private_key");
    expect(kinds("-----BEGIN OPENSSH PRIVATE KEY-----")).toContain("private_key");
    expect(kinds("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U")).toContain("jwt");
  });

  it("detects passwords in URLs and env assignments", () => {
    expect(kinds("https://admin:hunter2@example.com/db")).toContain("password_in_url");
    expect(kinds("DB_PASSWORD=supersecret")).toContain("env_secret");
    expect(kinds("password: hunter2")).toContain("password_value");
  });

  it("does not flag normal evidence text", () => {
    expect(findSecrets("Implemented password reset flow; see commit 4f2a9c1 and https://github.com/org/repo/pull/12")).toEqual([]);
    expect(findSecrets("Deployed to https://staging.example.com, Lighthouse 98")).toEqual([]);
  });
});
