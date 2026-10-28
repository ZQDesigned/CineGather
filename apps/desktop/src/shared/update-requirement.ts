import { versionBelow } from "@cinegather/contracts";

// Multiple trusted channels can describe the same requirement differently.
// Only a higher compatibility floor advances an already displayed requirement.
export function shouldAdvanceUpdateRequirement(
  currentVersion: string,
  previousMinimum: string | undefined,
  minimumVersion: string,
) {
  return (
    versionBelow(currentVersion, minimumVersion) &&
    (!previousMinimum || versionBelow(previousMinimum, minimumVersion))
  );
}
