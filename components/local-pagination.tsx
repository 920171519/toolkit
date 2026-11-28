export function LocalPagination({ label, className, page, pages, onPageChange, countClassName, announceCount }: {
  label: string;
  className?: string;
  page: number;
  pages: number;
  onPageChange: (page: number) => void;
  countClassName?: string;
  announceCount?: boolean;
}) {
  if (pages <= 1) return null;

  return (
    <nav className={className} aria-label={label}>
      <button type="button" className="button button-secondary button-sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>上一页</button>
      <span className={countClassName} role={announceCount ? "status" : undefined}>第 {page} / {pages} 页</span>
      <button type="button" className="button button-secondary button-sm" disabled={page >= pages} onClick={() => onPageChange(page + 1)}>下一页</button>
    </nav>
  );
}
