import Link from "next/link";
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

const pageIcons = {
  chevrons: { Previous: ChevronLeft, Next: ChevronRight, size: 14 },
  arrows: { Previous: ArrowLeft, Next: ArrowRight, size: 13 },
};
const linkClassName = "button button-secondary button-sm";

export function PageLinks({ page, pages, href, icons, children }: {
  page: number;
  pages: number;
  href: (page: number) => string;
  icons?: keyof typeof pageIcons;
  children?: ReactNode;
}) {
  const icon = icons && pageIcons[icons];

  return (
    <>
      {page > 1 && (
        <Link href={href(page - 1)} prefetch={false} className={linkClassName}>
          {icon && <icon.Previous size={icon.size} aria-hidden="true" />}上一页
        </Link>
      )}
      {children}
      {page < pages && (
        <Link href={href(page + 1)} prefetch={false} className={linkClassName}>
          下一页{icon && <icon.Next size={icon.size} aria-hidden="true" />}
        </Link>
      )}
    </>
  );
}
