import { describe, expect, it } from "vitest";
import { approvalAuthorityLabel, builtInProfiles, getProfile } from "../src/model/profiles";

describe("SOP profiles", () => {
  it("ships a GLWCH profile with commander and deputy signer presets", () => {
    const profile = getProfile("glwch");
    expect(profile.headerLines).toContain("Defense Health Agency");
    expect(profile.headerLines).toContain("General Leonard Wood Community Hospital");
    expect(profile.signerPresets.map((preset) => preset.approvalAuthority)).toEqual(["commander", "deputy"]);
    expect(builtInProfiles).toHaveLength(1);
  });

  it("labels approval authorities", () => {
    expect(approvalAuthorityLabel("commander")).toBe("Hospital Commander");
    expect(approvalAuthorityLabel("deputy")).toBe("Deputy");
  });
});
