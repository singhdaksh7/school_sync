import { describe, it, expect } from "vitest";
import { hashInviteToken, generateInviteToken } from "@/lib/invite-tokens";

describe("invite token hashing", () => {
  it("hashes deterministically and never equals the raw token", () => {
    const raw = "some-raw-invite-token";
    const hash = hashInviteToken(raw);
    expect(hash).toHaveLength(64); // sha256 hex
    expect(hash).toBe(hashInviteToken(raw)); // deterministic
    expect(hash).not.toBe(raw); // hash is not the raw token
  });

  it("supports lookup-by-hash: the emailed raw token hashes to the stored value", () => {
    const { rawToken, tokenHash } = generateInviteToken();
    // Simulates the accept route: store tokenHash, look up by hash(rawFromLink).
    expect(hashInviteToken(rawToken)).toBe(tokenHash);
  });

  it("prevents reusing the stored hash itself as a raw token", () => {
    const { rawToken, tokenHash } = generateInviteToken();
    // An attacker who reads the DB gets tokenHash. Presenting it as the token
    // link hashes it again → does not match the stored hash → lookup fails.
    expect(hashInviteToken(tokenHash)).not.toBe(tokenHash);
    expect(hashInviteToken(tokenHash)).not.toBe(hashInviteToken(rawToken));
  });

  it("generates unique tokens across calls", () => {
    const a = generateInviteToken();
    const b = generateInviteToken();
    expect(a.rawToken).not.toBe(b.rawToken);
    expect(a.tokenHash).not.toBe(b.tokenHash);
  });
});
