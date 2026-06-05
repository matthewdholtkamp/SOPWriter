import type { ApprovalAuthority, Signature } from "./sopSpec";

export type SignerPreset = Signature & {
  label: string;
};

export type SopProfile = {
  id: string;
  displayName: string;
  headerLines: string[];
  sealAssetPath: string | null;
  defaultProponent: string;
  signerPresets: SignerPreset[];
};

export const builtInProfiles: SopProfile[] = [
  {
    id: "glwch",
    displayName: "General Leonard Wood Community Hospital",
    headerLines: [
      "Defense Health Agency",
      "General Leonard Wood Community Hospital",
      "Fort Leonard Wood, Missouri"
    ],
    sealAssetPath: "assets/seals/dod-seal.png",
    defaultProponent: "Department of ___ (DCN ___)",
    signerPresets: [
      {
        label: "Hospital Commander",
        name: "[COMMANDER NAME]",
        rankBranch: "COL, MC",
        title: ["Commander"],
        approvalAuthority: "commander"
      },
      {
        label: "Deputy Commander",
        name: "Matthew D. Holtkamp",
        rankBranch: "COL, MC",
        title: ["Deputy Commander for Clinical Services"],
        approvalAuthority: "deputy"
      }
    ]
  }
];

export function getProfile(profileId: string): SopProfile {
  return builtInProfiles.find((profile) => profile.id === profileId) ?? builtInProfiles[0];
}

export function approvalAuthorityLabel(approvalAuthority: ApprovalAuthority): string {
  return approvalAuthority === "commander" ? "Hospital Commander" : "Deputy";
}
