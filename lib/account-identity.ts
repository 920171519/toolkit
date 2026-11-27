export function normalizeEmployeeId(value: string): string {
  return value.trim().toUpperCase();
}

export function isValidEmployeeId(value: string): boolean {
  return /^[A-Za-z0-9_-]{3,32}$/.test(value);
}

export function isValidAccountDisplayName(value: string): boolean {
  return value.length >= 2 && value.length <= 30;
}
