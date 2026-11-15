import Link from "next/link";

export function Brand({
  href = "/",
  compact = false,
}: {
  href?: string;
  compact?: boolean;
}) {
  return (
    <Link href={href} className="brand" aria-label="工程协同台首页">
      <span className="brand-mark">工</span>
      {!compact && (
        <span className="brand-copy">
          <span className="brand-name">工程协同台</span>
          <span className="brand-sub">Engineering Hub / 软件工程部</span>
        </span>
      )}
    </Link>
  );
}
