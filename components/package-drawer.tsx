"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArrowUpRight,
  ExternalLink as ExternalLinkIcon,
  LoaderCircle,
  Pencil,
  X,
} from "lucide-react";
import type { PackageDetailData, PersonOption } from "@/lib/queries";
import { formatDateTime } from "@/lib/format";
import { updatePackageResponsibilityAction } from "@/lib/actions/settings";
import type { ActionState } from "@/lib/action-state";
import { Avatar, Badge, StatusPill } from "@/components/ui";

export type DrawerPayload = PackageDetailData & { canEdit: boolean };
type PackageUsage = PackageDetailData["usages"][number];

const initialActionState: ActionState = {};

function UsageProject({ usage }: { usage: PackageUsage }) {
  return (
    <div className="drawer-usage-project">
      <div className="toolbar" style={{ gap: 7 }}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>{usage.projectName}</span>
        <span className="chip">{usage.projectCode}</span>
        {usage.projectStatus === "ARCHIVED" && (
          <Badge tone="slate">
            <Archive size={10} /> 存档
          </Badge>
        )}
      </div>
      <div className="project-nodes" style={{ marginTop: 7 }}>
        {usage.nodes.map((node) => (
          <span className="chip" key={node.nodeId}>
            {node.nodeName}
          </span>
        ))}
      </div>
    </div>
  );
}

export function PackageDrawer({
  packageId,
  people,
  onClose,
  initialDetail = null,
}: {
  packageId: number;
  people: PersonOption[];
  onClose: () => void;
  initialDetail?: DrawerPayload | null;
}) {
  const router = useRouter();
  const [detail, setDetail] = useState<DrawerPayload | null>(initialDetail);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [state, setState] = useState<ActionState>(initialActionState);
  const [pending, startTransition] = useTransition();

  const loadDetail = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch(`/api/packages/${packageId}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      const payload = (await response.json()) as DrawerPayload & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "软件包详情加载失败。");
      }
      setDetail(payload);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "软件包详情加载失败。");
    } finally {
      setLoading(false);
    }
  }, [packageId]);

  useEffect(() => {
    if (initialDetail) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading drawer data from an external API
    void loadDetail();
  }, [initialDetail, loadDetail]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  function submitResponsibility(formData: FormData) {
    startTransition(async () => {
      const result = await updatePackageResponsibilityAction(initialActionState, formData);
      setState(result);
      if (result.error) return;
      setEditing(false);
      await loadDetail();
      router.refresh();
    });
  }

  return (
    <div className="drawer-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="package-drawer" role="dialog" aria-modal="true" aria-label="软件包详情" data-testid="package-drawer">
        <header className="drawer-header">
          <div>
            <div className="eyebrow">Package detail</div>
            <h2>{detail?.package.name ?? "加载中…"}</h2>
            {detail && (
              <>
              <div className="toolbar" style={{ gap: 7, marginTop: 6 }}>
                <span className="chip">{detail.package.code}</span>
                <span className="chip">{detail.package.areaName ?? "未归属责任田"}</span>
                <Badge tone={detail.package.isActive ? "emerald" : "slate"} dot>
                  {detail.package.isActive ? "启用中" : "已停用"}
                </Badge>
              </div>
              <p className="small muted" style={{ marginTop: 8, maxWidth: 620, lineHeight: 1.55 }}>{detail.package.description || "暂无软件包说明。"}</p>
              </>
            )}
          </div>
          <button type="button" className="drawer-close" onClick={onClose} aria-label="关闭详情">
            <X size={18} />
          </button>
        </header>

        <div className="drawer-body">
          {loading && !detail ? (
            <div className="drawer-loading">
              <LoaderCircle size={20} style={{ animation: "spin 1s linear infinite" }} />
              正在加载软件包详情…
            </div>
          ) : loadError ? (
            <div className="form-error">{loadError}</div>
          ) : detail ? (
            <>
              <div className="drawer-summary">
                <div>
                  <div className="small muted">正式版本</div>
                  <div className="version-badge" style={{ fontSize: 18, color: "var(--brand)" }}>
                    {detail.package.formalVersion ?? "—"}
                  </div>
                </div>
                <div>
                  <div className="small muted">试制 / 待转正</div>
                  {detail.package.trialVersions.length > 0 ? (
                    <div className="version-stack" style={{ marginTop: 2 }}>
                      {detail.package.trialVersions.map((version) => (
                        <div className="version-badge" key={version} style={{ fontSize: 16, color: "var(--teal)" }}>{version}</div>
                      ))}
                    </div>
                  ) : (
                    <div className="version-badge" style={{ fontSize: 18, color: "var(--teal)" }}>—</div>
                  )}
                </div>
                <div>
                  <div className="small muted">在途版本</div>
                  <div className="version-badge" style={{ fontSize: 18 }}>
                    {detail.package.currentVersion ?? "—"}
                  </div>
                  {detail.package.currentStatus && (
                    <div style={{ marginTop: 4 }}>
                      <StatusPill status={detail.package.currentStatus} />
                    </div>
                  )}
                </div>
              </div>

              {state?.success && (
                <div className="flash" data-tone="success" style={{ marginTop: 14, marginBottom: 0 }}>
                  {state.success}
                </div>
              )}

              <section className="drawer-section">
                <div className="drawer-section-head">
                  <div>
                    <h3>责任信息</h3>
                    <p>责任田项目负责人、软件经理或管理员可修改</p>
                  </div>
                  {detail.canEdit && (
                    <button
                      type="button"
                      className="button button-secondary button-sm"
                      onClick={() => setEditing((value) => !value)}
                      data-testid="package-responsibility-toggle"
                    >
                      {editing ? "取消编辑" : <><Pencil size={12} /> 编辑责任信息</>}
                    </button>
                  )}
                </div>
                {editing ? (
                  <form action={submitResponsibility} className="drawer-edit-form" data-testid="package-responsibility-form">
                    <input type="hidden" name="packageId" value={detail.package.id} />
                    <div className="form-grid">
                      <label className="field">
                        <span className="label">责任人</span>
                        <select
                          className="select"
                          name="ownerId"
                          defaultValue={detail.package.ownerId ?? ""}
                          required
                        >
                          <option value="" disabled>选择责任人</option>
                          {people.map((person) => (
                            <option key={person.id} value={person.id}>
                              {person.name} · {person.employeeId}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        <span className="label">责任田</span>
                        <input className="input" value={detail.package.areaName ?? "未归属"} readOnly />
                      </label>
                      <label className="field span-2">
                        <span className="label">软件包说明</span>
                        <textarea
                          className="textarea"
                          name="description"
                          defaultValue={detail.package.description}
                        />
                      </label>
                      <label className="check-item span-2" style={{ maxWidth: 300 }}>
                        <input
                          type="checkbox"
                          name="isActive"
                          defaultChecked={detail.package.isActive}
                        />
                        <span>
                          启用此软件包
                          <span className="small muted" style={{ display: "block" }}>
                            有在途版本时不能停用。
                          </span>
                        </span>
                      </label>
                    </div>
                    {state?.error && <div className="form-error">{state.error}</div>}
                    <div className="form-footer">
                      <button type="button" className="button button-ghost button-sm" onClick={() => setEditing(false)}>
                        取消
                      </button>
                      <button type="submit" className="button button-primary button-sm" disabled={pending}>
                        {pending && <LoaderCircle size={13} style={{ animation: "spin 1s linear infinite" }} />}
                        {pending ? "保存中…" : "保存责任信息"}
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="drawer-responsibility">
                    <div className="toolbar" style={{ gap: 9 }}>
                      <Avatar name={detail.package.ownerName ?? "未指定"} size="sm" />
                      <div className="person-inline-copy">
                        <span className="person-inline-name">{detail.package.ownerName ?? "责任人待指定"}</span>
                        <span className="person-inline-meta">
                          {detail.package.ownerTitle || "软件包责任人"}
                          {detail.package.ownerEmployeeId ? ` · ${detail.package.ownerEmployeeId}` : ""}
                        </span>
                      </div>
                    </div>
                    <p className="change-copy" style={{ marginTop: 9 }}>
                      {detail.package.description || "暂无说明。"}
                    </p>
                  </div>
                )}
              </section>

              <section className="drawer-section">
                <div className="drawer-section-head">
                  <div>
                    <h3>使用范围</h3>
                    <p>发布试制后，在行项目的这些节点都会生成绑定验证任务</p>
                  </div>
                  <span className="chip">{detail.usages.length} 个项目</span>
                </div>
                {detail.usages.length === 0 ? (
                  <div className="muted-panel">暂未配置项目使用范围。</div>
                ) : (
                  <div className="drawer-usage-list">
                    {detail.usages.map((usage) => (
                      <UsageProject usage={usage} key={usage.projectId} />
                    ))}
                  </div>
                )}
              </section>

              <section className="drawer-section">
                <div className="drawer-section-head">
                  <div>
                    <h3>版本历史</h3>
                    <p>每个版本都保留变更说明、归档链接与流程结果</p>
                  </div>
                  <span className="chip">{detail.versions.length} 个版本</span>
                </div>
                {detail.versions.length === 0 ? (
                  <div className="muted-panel">暂无版本记录。</div>
                ) : (
                  <div className="drawer-version-list">
                    {detail.versions.map((version) => (
                      <article className="drawer-version" key={version.id}>
                        <div className="toolbar" style={{ gap: 7 }}>
                          <span className="version-badge" style={{ fontSize: 13 }}>{version.version}</span>
                          {version.status === "VOID" && version.voidKind ? (
                            <Badge tone="slate">{version.voidKind === "ABANDON" ? "放弃试制" : version.voidKind === "FORMAL" ? "正式版作废" : "试制作废"}</Badge>
                          ) : <StatusPill status={version.status} />}
                          {version.batchCode && (
                            <Link href={`/integration/${version.batchId}`} className="chip">
                              {version.batchCode}
                            </Link>
                          )}
                          {version.formFlowNo && <span className="chip">电子流 {version.formFlowNo}</span>}
                          <Link href={`/versions/${version.id}`} className="archive-link" style={{ marginLeft: "auto" }}>全链路追溯</Link>
                        </div>
                        <p className="change-copy">{version.changeSummary}</p>
                        <div className="toolbar" style={{ gap: 13, marginTop: 7, fontSize: 11, color: "var(--muted)" }}>
                          <span>{version.submittedByName ?? "系统"} 提交 · {formatDateTime(version.submittedAt)}</span>
                          {version.trialReleasedAt && <span>试制 {formatDateTime(version.trialReleasedAt)}</span>}
                          {version.formalReleasedAt && <span>转正 {formatDateTime(version.formalReleasedAt)}</span>}
                          <a href={version.archiveUrl} target="_blank" rel="noreferrer" className="archive-link">
                            归档包 <ExternalLinkIcon size={11} />
                          </a>
                          {version.buildUrl && <a href={version.buildUrl} target="_blank" rel="noreferrer" className="archive-link">构建地址 <ExternalLinkIcon size={11} /></a>}
                        </div>
                        {version.bindingTotal > 0 && (
                          <div style={{ marginTop: 7 }}>
                            <Badge tone={version.bindingPassed === version.bindingTotal ? "emerald" : "amber"}>
                              绑定验证 {version.bindingPassed}/{version.bindingTotal}
                            </Badge>
                          </div>
                        )}
                      </article>
                    ))}
                  </div>
                )}
              </section>

              <div className="drawer-footer-actions">
                <Link href="/submissions" className="button button-secondary button-sm">
                  提交转测申请 <ArrowUpRight size={12} />
                </Link>
              </div>
            </>
          ) : null}
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </aside>
    </div>
  );
}