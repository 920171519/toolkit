export type Notice = {
  tone: "success" | "error" | "info";
  message: string;
};

export function readFlash({ flash, tone }: Record<string, string | string[] | undefined>): Notice | null {
  if (!flash) return null;
  return { tone: tone === "error" ? "error" : "success", message: Array.isArray(flash) ? flash[0] : flash };
}
