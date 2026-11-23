export function releaseFlowUrl(value?: string | null): string | undefined {
  const candidate = value?.trim();
  if (!candidate || !/^https?:\/\/[^/?#\\]/i.test(candidate) || /[\s\\]/.test(candidate)) return undefined;
  try {
    const url = new URL(candidate);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname ? candidate : undefined;
  } catch {
    return undefined;
  }
}
