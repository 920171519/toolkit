export type Notice = {
  tone: "success" | "error" | "info";
  message: string;
};

export function parseFlash(
  flash: string | string[] | undefined,
  fallbackTone: "success" | "error" | "info" = "success",
): Notice | null {
  if (!flash) return null;
  return { tone: fallbackTone, message: Array.isArray(flash) ? flash[0] : flash };
}
