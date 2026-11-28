import Link from "next/link";
import { PRODUCT_NAME } from "@/lib/constants";

export function Brand({
  href = "/",
  compact = false,
  subtitle = "软件工程部",
}: {
  href?: string;
  compact?: boolean;
  subtitle?: string;
}) {
  return (
    <Link href={href} prefetch={false} className="brand" aria-label={`${PRODUCT_NAME}首页`} aria-description={compact ? undefined : subtitle}>
      <span className="brand-mark">工</span>
      {!compact && (
        <span className="brand-copy">
          <span className="brand-name">{PRODUCT_NAME}</span>
          <span className="brand-sub" title={subtitle}>{subtitle}</span>
        </span>
      )}
    </Link>
  );
}
