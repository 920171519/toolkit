export function parsePositiveSafeInteger(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

export function parseDecimalId(value: unknown): number | undefined {
  return typeof value === "string" && /^[1-9][0-9]*$/.test(value)
    ? parsePositiveSafeInteger(value)
    : undefined;
}
