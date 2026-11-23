import { releaseFlowUrl } from "@/lib/release-flow";
import { ExternalLink } from "./ui";

export function ReleaseFlowEvidence({ value, label = "打开电子流" }: {
  value?: string | null;
  label?: string;
}) {
  const href = releaseFlowUrl(value);
  return href ? <ExternalLink href={href}>{label}</ExternalLink> : value?.trim() || "—";
}
