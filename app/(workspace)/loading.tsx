export default function WorkspaceLoading() {
  return (
    <div className="workspace-loading" aria-busy="true" aria-label="页面加载中">
      <div className="skeleton-line skeleton-title" aria-hidden="true" />
      <div className="skeleton-panel" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((item) => <div className="skeleton-row" key={item} />)}
      </div>
    </div>
  );
}
