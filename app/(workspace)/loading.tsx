export default function WorkspaceLoading() {
  return (
    <div className="workspace-loading" aria-busy="true" aria-label="页面加载中">
      <div className="skeleton-line skeleton-eyebrow" />
      <div className="skeleton-line skeleton-title" />
      <div className="skeleton-line skeleton-desc" />
      <div className="skeleton-metrics">
        {[0, 1, 2, 3].map((item) => <div className="skeleton-card" key={item} />)}
      </div>
      <div className="skeleton-panel" />
      <div className="skeleton-panel skeleton-panel-small" />
    </div>
  );
}
