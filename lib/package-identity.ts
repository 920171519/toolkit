export const PACKAGE_CODE_EXAMPLE = "10001OTA";
export const PACKAGE_CODE_PATTERN = "[0-9]{5}[A-Za-z]{3}";

const legacyIdentifier = /^[0-9]{4,5}[A-Za-z]{3}$/;
const standardIdentifier = new RegExp("^" + PACKAGE_CODE_PATTERN + "$");

export function isStandardPackageCode(code: string) {
  return standardIdentifier.test(code);
}

export function packageIdentity(packageRow: { name: string; code: string }) {
  if (legacyIdentifier.test(packageRow.name) && !legacyIdentifier.test(packageRow.code)) {
    return { name: packageRow.code, code: packageRow.name };
  }
  return { name: packageRow.name, code: packageRow.code };
}
