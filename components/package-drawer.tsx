"use client";

import { useCallback, useEffect, useId, useRef, useState, useTransition, type KeyboardEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, LoaderCircle, Pencil, Search, X } from "lucide-react";
import type { PackageDetailData, PersonOption } from "@/lib/queries";
import type { ActionState } from "@/lib/action-state";
import { formatDateTime } from "@/lib/format";
import { packageIdentity } from "@/lib/package-identity";
import { updatePackageResponsibilityAction } from "@/lib/actions/settings";
import { workflowHref } from "@/lib/workflow-links";
import { Avatar, Badge, EmptyState, ExternalLink, StatusPill } from "@/components/ui";
import { SettingsPersonPicker } from "@/components/settings-person-picker";
import { SettingsPackageActivation, type PackageDeactivationBlockers } from "@/components/settings-package-activation";
import { ReleaseFlowEvidence } from "@/components/release-flow-evidence";
import { releaseFlowUrl } from "@/lib/release-flow";
import styles from "./package-drawer.module.css";

export type DrawerPayload = PackageDetailData & { canEdit: boolean; deactivationBlockers: PackageDeactivationBlockers };

const panels = [
  { id: "overview", label: "概览" },
  { id: "versions", label: "版本历史" },
  { id: "usage", label: "使用范围" },
] as const;

type DrawerPanel = typeof panels[number]["id"];
type PackageVersion = PackageDetailData["versions"][number];

const listPageSize = 10;
const initialActionState: ActionState = {};

function normalized(value: string) {
  return value.normalize("NFKC").trim().toLowerCase();
}

function useDrawerFilter<Row>(rows: Row[], searchable: (row: Row) => string) {
  const [query, setQuery] = useState("");
  const [requestedPage, setPage] = useState(1);
  const terms = normalized(query).split(/\s+/).filter(Boolean);
  const matching = terms.length === 0 ? rows : rows.filter((row) => {
    const text = normalized(searchable(row));
    return terms.every((term) => text.includes(term));
  });
  const pageCount = Math.max(1, Math.ceil(matching.length / listPageSize));
  const page = Math.min(requestedPage, pageCount);
  const start = (page - 1) * listPageSize;
  return {
    query,
    setQuery: (value: string) => { setQuery(value); setPage(1); },
    rows: matching.slice(start, start + listPageSize),
    count: matching.length,
    start,
    page,
    pageCount,
    setPage,
  };
}

function DrawerSearch({ label, placeholder, query, onChange }: {
  label: string; placeholder: string; query: string; onChange: (value: string) => void;
}) {
  return (
    <label className="workspace-search">
      <Search size={16} aria-hidden="true" />
      <input type="search" aria-label={label} placeholder={placeholder} value={query} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function DrawerPagination({ label, count, start, page, pageCount, setPage }: {
  label: string; count: number; start: number; page: number; pageCount: number; setPage: (value: number) => void;
}) {
  return (
    <div className={styles.pagination}>
      <span className="small muted" role="status">{count > 0 ? `${start + 1}–${Math.min(start + listPageSize, count)} / ${count} 条` : "0 条"}</span>
      {pageCount > 1 && <nav aria-label={label}>
        <button type="button" className="button button-secondary button-sm" disabled={page === 1} onClick={() => setPage(page - 1)}>上一页</button>
        <span>第 {page} / {pageCount} 页</span>
        <button type="button" className="button button-secondary button-sm" disabled={page === pageCount} onClick={() => setPage(page + 1)}>下一页</button>
      </nav>}
    </div>
  );
}

function VersionRows({ versions, projectId }: { versions: PackageVersion[]; projectId?: number }) {
  return (
    <ul className={styles.versionList}>
      {versions.map((version) => (
        <li key={version.id} className={styles.version}>
          <div className={styles.rowHeader}>
            <h4 className="mono">{version.version}</h4>
            {version.status === "VOID" && version.voidKind
              ? <Badge>{version.voidKind === "ABANDON" ? "放弃试制" : version.voidKind === "FORMAL" ? "正式版作废" : "试制作废"}</Badge>
              : <StatusPill status={version.status} />}
            <Link href={workflowHref(`/versions/${version.id}`, projectId)} prefetch={false} className="archive-link">全链路追溯</Link>
          </div>
          <p>{version.changeSummary}</p>
          <div className={styles.versionMeta}>
            <span>{version.submittedByName ?? "系统"} 提交 · {formatDateTime(version.submittedAt)}</span>
            {version.trialReleasedAt && <span>试制 {formatDateTime(version.trialReleasedAt)}</span>}
            {version.formalReleasedAt && <span>转正 {formatDateTime(version.formalReleasedAt)}</span>}
            {version.formFlowNo && (releaseFlowUrl(version.formFlowNo)
              ? <ReleaseFlowEvidence value={version.formFlowNo} label="查看转正电子流" />
              : <span>电子流 {version.formFlowNo}</span>)}
            {version.bindingTotal > 0 && <span>绑定验证 {version.bindingPassed}/{version.bindingTotal}</span>}
          </div>
          <div className={styles.versionLinks}>
            {version.batchId && version.batchCode && <Link href={workflowHref(`/integration/${version.batchId}`, projectId)} prefetch={false} className="archive-link">批次 {version.batchCode}</Link>}
            <ExternalLink href={version.archiveUrl}>归档包</ExternalLink>
            {version.buildUrl && <ExternalLink href={version.buildUrl}>构建地址</ExternalLink>}
          </div>
        </li>
      ))}
    </ul>
  );
}

function VersionHistory({ versions, packageId, projectId }: { versions: PackageVersion[]; packageId: number; projectId?: number }) {
  const filter = useDrawerFilter(versions, (version) => [
    version.version, version.changeSummary, version.batchCode, version.formFlowNo, version.submittedByName,
  ].join(" "));
  return (
    <>
      <div className={styles.sectionHeading}>
        <DrawerSearch label="搜索版本" placeholder="版本号、批次或提交人" query={filter.query} onChange={filter.setQuery} />
        <Link href={workflowHref("/versions", projectId, { package: packageId })} prefetch={false} className="archive-link">查看全部版本追溯</Link>
      </div>
      {filter.rows.length > 0 ? <VersionRows versions={filter.rows} projectId={projectId} /> :
        <EmptyState title={filter.query ? "没有匹配的版本" : "暂无版本记录"} action={filter.query ? <button type="button" className="button button-secondary button-sm" onClick={() => filter.setQuery("")}>清除搜索</button> : undefined} />}
      {versions.length > 0 && <DrawerPagination label="版本历史分页" {...filter} />}
    </>
  );
}

function UsageList({ usages }: { usages: PackageDetailData["usages"] }) {
  const filter = useDrawerFilter(usages, (usage) => [usage.projectName, usage.projectCode, ...usage.nodes.map((node) => node.nodeName)].join(" "));
  return (
    <>
      <DrawerSearch label="搜索项目或节点" placeholder="项目名称、代号或节点" query={filter.query} onChange={filter.setQuery} />
      {filter.rows.length > 0 ? (
        <dl className={styles.usageList}>
          {filter.rows.map((usage) => <div key={usage.projectId}>
            <dt>{usage.projectName} <span className="small muted">{usage.projectCode}</span>{usage.projectStatus === "ARCHIVED" && <span className="small muted"> · 已结束</span>}</dt>
            <dd>{usage.nodes.map((node) => node.nodeName).join("、") || "—"}</dd>
          </div>)}
        </dl>
      ) : <EmptyState title={filter.query ? "没有匹配的使用范围" : "暂无项目使用范围"} action={filter.query ? <button type="button" className="button button-secondary button-sm" onClick={() => filter.setQuery("")}>清除搜索</button> : undefined} />}
      {usages.length > 0 && <DrawerPagination label="使用范围分页" {...filter} />}
    </>
  );
}

export function PackageDrawer({ packageId, projectId, hasProjectWorkflowScope = true, people, onClose, initialDetail = null, readOnly = false, initialPanel = "overview" }: {
  packageId: number;
  projectId?: number;
  hasProjectWorkflowScope?: boolean;
  people: PersonOption[];
  onClose: () => void;
  initialDetail?: DrawerPayload | null;
  readOnly?: boolean;
  initialPanel?: DrawerPanel;
}) {
  const workflowProjectId = hasProjectWorkflowScope ? projectId : undefined;
  const router = useRouter();
  const [detail, setDetail] = useState<DrawerPayload | null>(initialDetail);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [panel, setPanel] = useState<DrawerPanel>(initialPanel);
  const [editing, setEditing] = useState(false);
  const [state, setState] = useState<ActionState>(initialActionState);
  const [pending, startTransition] = useTransition();
  const drawer = useRef<HTMLDialogElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const id = useId();

  const loadDetail = useCallback(async () => {
    setLoadError(null);
    try {
      const response = await fetch(workflowHref(`/api/packages/${packageId}`, projectId), {
        credentials: "same-origin",
        cache: "no-store",
      });
      const payload = (await response.json()) as DrawerPayload & { error?: string };
      if (!response.ok) throw new Error(payload.error || "软件包详情加载失败。");
      setDetail(payload);
      return true;
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "软件包详情加载失败。");
      return false;
    }
  }, [packageId, projectId]);

  useEffect(() => {
    if (initialDetail) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads details from the package API
    void loadDetail();
  }, [initialDetail, loadDetail]);

  useEffect(() => {
    const dialog = drawer.current;
    if (!dialog) return;
    const previousFocus = document.activeElement;
    dialog.close();
    dialog.showModal();
    return () => {
      dialog.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    if (editing) body.current?.querySelector<HTMLInputElement>("input[type=search]")?.focus();
  }, [editing]);

  function activate(next: DrawerPanel) {
    setPanel(next);
    if (body.current) body.current.scrollTop = 0;
  }

  function handleTabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number;
    if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = panels.length - 1;
    else if (event.key === "ArrowRight") nextIndex = (index + 1) % panels.length;
    else if (event.key === "ArrowLeft") nextIndex = (index + panels.length - 1) % panels.length;
    else return;
    event.preventDefault();
    const nextPanel = panels[nextIndex].id;
    activate(nextPanel);
    drawer.current?.querySelector<HTMLButtonElement>(`[data-package-panel="${nextPanel}"]`)?.focus();
  }

  function cancelEdit() {
    setEditing(false);
    setState(initialActionState);
    requestAnimationFrame(() => editButton.current?.focus());
  }

  function submitResponsibility(formData: FormData) {
    startTransition(async () => {
      const result = await updatePackageResponsibilityAction(initialActionState, formData);
      setState(result);
      if (result.error) return;
      setEditing(false);
      await loadDetail();
      router.refresh();
      requestAnimationFrame(() => editButton.current?.focus());
    });
  }

  function dismiss() {
    if (editing) {
      if (!pending) cancelEdit();
    } else onClose();
  }

  const pkg = detail?.package;
  const identity = pkg && packageIdentity(pkg);
  const currentTabId = `${id}-tab-${panel}`;

  return (
    <dialog ref={drawer} open className="package-drawer workspace-package-drawer" aria-label="软件包详情" data-testid="package-drawer"
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right ||
          event.clientY < bounds.top || event.clientY > bounds.bottom) dismiss();
      }}
      onCancel={(event) => { event.preventDefault(); event.stopPropagation(); dismiss(); }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented || event.nativeEvent.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        dismiss();
      }}>
      <header className={styles.header}>
        <div>
          <h2 className={identity ? "mono" : undefined}>{identity?.code ?? "软件包详情"}</h2>
          {pkg && <p className="small muted">{pkg.areaName || "未归属责任田"}{!pkg.isActive && " · 已停用"}</p>}
        </div>
        <button type="button" className="drawer-close" onClick={onClose} aria-label="关闭详情" disabled={pending}><X size={18} aria-hidden="true" /></button>
      </header>

      {detail && !editing && <div className={styles.tabs} role="tablist" aria-label="软件包资料">
        {panels.map((item, index) => (
          <button type="button" key={item.id} data-package-panel={item.id} id={`${id}-tab-${item.id}`} role="tab" aria-selected={panel === item.id}
            aria-controls={`${id}-panel-${item.id}`} tabIndex={panel === item.id ? 0 : -1}
            onKeyDown={(event) => handleTabKey(event, index)} onClick={() => activate(item.id)}>{item.label}</button>
        ))}
      </div>}

      <div ref={body} className={styles.body}>
        {identity && identity.name !== identity.code && <p className={styles.packageName}>{identity.name}</p>}
        {loadError && <div className="form-error" role="alert"><span>{loadError}</span><button type="button" className="button button-secondary button-sm" onClick={() => void loadDetail()}>重试</button></div>}
        {!detail && !loadError && <div className="drawer-loading" role="status"><LoaderCircle size={20} className="animate-spin" aria-hidden="true" />正在加载软件包详情…</div>}

        {detail && pkg && editing && (
          <form action={submitResponsibility} onReset={(event) => event.preventDefault()} className={styles.editor} data-testid="package-responsibility-form">
            <h3>编辑责任信息</h3>
            <input type="hidden" name="packageId" value={pkg.id} />
            <SettingsPersonPicker name="ownerId" label="责任人" defaultValue={pkg.ownerId ?? ""} options={people.map((person) => ({ id: person.id, label: `${person.name} · ${person.employeeId}` }))} />
            <label className="field"><span className="label">软件包说明</span><textarea className="textarea" name="description" defaultValue={pkg.description} /></label>
            <SettingsPackageActivation className={styles.activeField} active={pkg.isActive} blockers={detail.deactivationBlockers} />
            {state.error && <div className="form-error" role="alert">{state.error}</div>}
            <div className="form-footer">
              <button type="button" className="button button-secondary" disabled={pending} onClick={cancelEdit}>取消</button>
              <button type="submit" className="button button-primary" disabled={pending}>{pending ? "保存中…" : "保存责任信息"}</button>
            </div>
          </form>
        )}

        {detail && pkg && !editing && (
          <div role="tabpanel" id={`${id}-panel-${panel}`} aria-labelledby={currentTabId} tabIndex={0}>
            {state.success && <div className="flash" data-tone="success" role="status">{state.success}</div>}
            {panel === "overview" && <>
              <dl className={styles.summary}>
                <div><dt>正式版本</dt><dd>{pkg.formalVersion ?? "—"}</dd></div>
                <div><dt>试制 / 待转正</dt><dd>{pkg.trialVersions.length ? pkg.trialVersions.join("、") : "—"}</dd></div>
                <div><dt>在途版本</dt><dd>{pkg.currentVersion ?? "—"}</dd>{pkg.currentStatus && <StatusPill status={pkg.currentStatus} />}</div>
              </dl>

              <section className={styles.section}>
                <div className={styles.sectionHeading}>
                  <h3>责任信息</h3>
                  {!readOnly && detail.canEdit && people.length > 0 && <button ref={editButton} data-testid="package-responsibility-toggle" type="button" className="button button-secondary button-sm" aria-label="编辑责任信息" onClick={() => {
                    setState(initialActionState);
                    setEditing(true);
                    if (body.current) body.current.scrollTop = 0;
                  }}><Pencil size={14} aria-hidden="true" />编辑</button>}
                </div>
                <div className={styles.person}>
                  <Avatar name={pkg.ownerName ?? "未指定"} size="sm" />
                  <div><strong>{pkg.ownerName ?? "责任人待指定"}</strong>{pkg.ownerName && <div className="small muted">{[pkg.ownerTitle, pkg.ownerEmployeeId].filter(Boolean).join(" · ")}</div>}</div>
                </div>
                {pkg.description && <p className={styles.description}>{pkg.description}</p>}
              </section>

              {detail.versions.length > 0 && <section className={styles.section}>
                <div className={styles.sectionHeading}>
                  <h3>最近版本</h3>
                </div>
                <VersionRows versions={detail.versions.slice(0, 3)} projectId={workflowProjectId} />
              </section>}
            </>}
            {panel === "versions" && <VersionHistory versions={detail.versions} packageId={packageId} projectId={workflowProjectId} />}
            {panel === "usage" && <UsageList usages={detail.usages} />}
          </div>
        )}
      </div>

      {!editing && detail && !readOnly && <footer className={styles.footer}>
        <Link href={workflowHref("/submissions/transfer", workflowProjectId, { package: packageId })} prefetch={false} className="button button-primary">提交转测申请 <ArrowUpRight size={15} aria-hidden="true" /></Link>
      </footer>}
    </dialog>
  );
}
