export const PACKAGE_CODE_EXAMPLE = "10001OTA";

const digit = "[0-9]";
const letter = "[A-Za-z]";
export const PACKAGE_CODE_PATTERN = `${digit}{5}${letter}{3}`;

const legacyIdentifier = new RegExp(`^${digit}{4,5}${letter}{3}$`);
const standardIdentifier = new RegExp("^" + PACKAGE_CODE_PATTERN + "$");
const legacyCodeGlobs = [4, 5].map((digits) => digit.repeat(digits) + letter.repeat(3));

export function isStandardPackageCode(code: string) {
  return standardIdentifier.test(code);
}

export function packageIdentity(packageRow: { name: string; code: string }) {
  if (legacyIdentifier.test(packageRow.name) && !legacyIdentifier.test(packageRow.code)) {
    return { name: packageRow.code, code: packageRow.name };
  }
  return { name: packageRow.name, code: packageRow.code };
}

export function packageCodeSql(nameColumn: string, codeColumn: string) {
  const matchesLegacyCode = (column: string) => legacyCodeGlobs.map((pattern) => `${column} GLOB '${pattern}'`).join(" OR ");
  return `CASE WHEN (${matchesLegacyCode(nameColumn)}) AND NOT (${matchesLegacyCode(codeColumn)}) THEN ${nameColumn} ELSE ${codeColumn} END`;
}
