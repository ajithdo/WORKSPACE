/**
 * Principle 6: no secrets in the app. Evidence text and small text uploads are scanned before they
 * are stored. Matches are reported by kind only — the secret itself is never echoed back.
 */
export interface SecretHit {
  kind: string;
  index: number;
}

const PATTERNS: { kind: string; re: RegExp }[] = [
  { kind: "private_key", re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/g },
  { kind: "aws_access_key", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: "github_token", re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b/g },
  { kind: "slack_token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { kind: "stripe_secret", re: /\b(?:sk|rk)_live_[0-9A-Za-z]{16,}\b/g },
  { kind: "google_api_key", re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { kind: "ai_api_key", re: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{32,}\b/g },
  { kind: "jwt", re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  { kind: "password_in_url", re: /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/gi },
  { kind: "env_secret", re: /\b[A-Z0-9_]*(?:SECRET|PASSWORD|PASSWD|TOKEN|API_KEY|APIKEY|PRIVATE_KEY|ACCESS_KEY)[A-Z0-9_]*\s*=\s*\S{4,}/g },
  { kind: "password_value", re: /\b(?:password|passwd|pwd|passcode|otp|pin)\s*[:=]\s*\S{3,}/gi },
];

export function findSecrets(text: string): SecretHit[] {
  const hits: SecretHit[] = [];
  for (const { kind, re } of PATTERNS) {
    re.lastIndex = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) hits.push({ kind, index: m.index });
  }
  return hits.sort((a, b) => a.index - b.index);
}

export const SECRET_KIND_LABELS: Record<string, string> = {
  private_key: "a private key",
  aws_access_key: "an AWS access key",
  github_token: "a GitHub token",
  slack_token: "a Slack token",
  stripe_secret: "a payment-gateway secret key",
  google_api_key: "a Google API key",
  ai_api_key: "an API key",
  jwt: "a login token (JWT)",
  password_in_url: "a password inside a URL",
  env_secret: "a secret value (KEY=value)",
  password_value: "a password",
};
