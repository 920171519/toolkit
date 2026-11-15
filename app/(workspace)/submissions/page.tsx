import type { Metadata } from "next";
import Link from "next/link";
import { Boxes, ClipboardList, Link2, UserRound } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { canCancelVersion, canManageWorkflow, canSubmitForPackage } from "@/lib/permissions";
import { getPackagesOverview, parseFlash } from "@/lib/queries";
import { getPendingTransferGroups, getWorkflowProjectScope } from "@/lib/workflow-queries";
import { formatDateTime } from "@/lib/format";
import { cancelTransferAction, submitTransferAction } from "@/lib/actions/workflow";
import { ActionForm } from "@/components/action-form";
import { Badge, EmptyState, ExternalLink, FlashMessage, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "待转测申请" };

export default async function SubmissionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const notice = parseFlash(params.flash, params.tone === "error" ? "error" : "success");
  const groups = getPendingTransferGroups(getWorkflowProjectScope(user));
  const packages = getPackagesOverview();
  const availablePackages = packages.filter(
    (pkg) => pkg.isActive && canSubmitForPackage(user, pkg.ownerId),
  );
  const manager = canManageWorkflow(user);
  const requestCount = groups.reduce((total, group) => total + group.items.length, 0);

  return (
    <>
      <PageHeader
        eyebrow="Transfer request / By project"
        title="待转测申请"
        description="转测申请按项目分发。一个软件包提交一次，会同步发送到它当前使用的全部在行项目；各项目可以独立安排集成测试，互不影响。"
        actions={
          manager ? (
            <Link href="/integration" className="button button-primary">
              <Boxes size={15} /> 进入项目测试安排
            </Link>
          ) : (
            <Link href="/packages" className="button button-secondary">查看版本总览</Link>
          )
        }
      />
      <FlashMessage notice={notice} />

      <div className="info-strip" style={{ marginBottom: 18 }}>
        <span><strong>{requestCount}</strong> 个项目转测申请</span>
        <span>覆盖 <strong>{groups.length}</strong> 个项目</span>
        <span>同一软件包可继续提交新版本，无需等待上一轮测试结束</span>
        <span style={{ marginLeft: "auto" }}>集成测试按项目独立排期</span>
      </div>

      <div className="two-col">
        <section className="card">
          <div className="card-header">
            <div>
              <h2 style={{ fontSize: 18 }}>按项目查看申请</h2>
              <p className="small muted" style={{ marginTop: 3 }}>
                软件经理可按项目组织 Bxxx 配套；同一版本会在它使用的多个项目中分别出现。
              </p>
            </div>
            <Badge tone="amber">{groups.length} 个项目</Badge>
          </div>
          <div className="card-body" style={{ paddingTop: 14 }}>
            {groups.length === 0 ? (
              <EmptyState title="没有待转测的申请" description="责任人提交后，申请会按项目出现在这里。" />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {groups.map((group) => (
                  <section key={group.projectId} className="project-request-group">
                    <div className="split-row">
                      <div className="toolbar" style={{ gap: 8 }}>
                        <span className="chip">{group.projectCode}</span>
                        <span style={{ fontSize: 14, fontWeight: 600 }}>{group.projectName}</span>
                        <Badge tone="amber">{group.items.length} 个申请</Badge>
                      </div>
                      {manager && (
                        <Link href={`/integration/new?project=${group.projectId}`} className="archive-link">
                          组织该项目转测
                        </Link>
                      )}
                    </div>
                    <div className="version-list">
                      {group.items.map((item) => (
                        <article key={`${group.projectId}-${item.requestId}`} className="version-row" style={{ alignItems: "flex-start", padding: "15px 0" }}>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div className="toolbar" style={{ gap: 8 }}>
                              <Link href={`/packages?open=${item.packageId}`} style={{ fontWeight: 600, fontSize: 14 }}>{item.packageName}</Link>
                              <span className="version-badge">{item.version}</span>
                              <Badge tone="amber" dot>待集成测试</Badge>
                            </div>
                            <p className="change-copy" style={{ marginTop: 7 }}>{item.changeSummary}</p>
                            <div className="toolbar" style={{ gap: 16, marginTop: 8, fontSize: 11, color: "var(--muted)" }}>
                              <span className="toolbar" style={{ gap: 5 }}><UserRound size={12} /> {item.submittedByName ?? "未知申请人"} · {formatDateTime(item.submittedAt)}</span>
                              <span className="toolbar" style={{ gap: 5 }}><Link2 size={12} /><ExternalLink href={item.archiveUrl}>包归档</ExternalLink></span>
                              <span>责任人 {item.ownerName ?? "未指定"}</span>
                            </div>
                          </div>
                          {item.versionStatus === "PENDING_TRANSFER" && canCancelVersion(user, item.submittedById) && (
                            <ActionForm
                              action={cancelTransferAction}
                              hidden={{ versionId: item.versionId }}
                              submitText="撤回申请"
                              submitVariant="outline-danger"
                              submitClassName="button-sm"
                              confirmMessage={`撤回将同时撤销 ${item.packageName} ${item.version} 在所有项目的转测申请，确认继续？`}
                              className="inline-action-form"
                            />
                          )}
                        </article>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>
        </section>

        <aside style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <section className="card">
            <div className="card-header">
              <div><div className="eyebrow">New request</div><h2 style={{ fontSize: 18, marginTop: 5 }}>提交转测申请</h2></div>
              <ClipboardList size={18} style={{ color: "var(--brand)" }} />
            </div>
            <div className="card-body" style={{ paddingTop: 14 }}>
              {availablePackages.length === 0 ? (
                <div className="muted-panel">
                  {manager ? "当前没有可提交的启用软件包。" : "你当前没有可提交的软件包。只有软件包责任人或软件经理可以提交。"}
                </div>
              ) : (
                <ActionForm action={submitTransferAction} testId="transfer-form" submitText="提交申请" pendingText="发送中…">
                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    <label className="field">
                      <span className="label">软件包 <span className="required-mark">*</span></span>
                      <select className="select" name="packageId" required defaultValue="" aria-required="true">
                        <option value="" disabled>选择软件包</option>
                        {availablePackages.map((pkg) => (
                          <option value={pkg.id} key={pkg.id}>{pkg.name} · {pkg.code}{pkg.ownerName ? ` / ${pkg.ownerName}` : ""}</option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span className="label">版本号 <span className="required-mark">*</span><span className="hint">例如 2.1.0</span></span>
                      <input className="input" name="version" placeholder="填写本次提交的新版本号" required maxLength={40} />
                    </label>
                    <label className="field">
                      <span className="label">修复问题 / 完成需求 <span className="required-mark">*</span></span>
                      <textarea className="textarea" name="changeSummary" placeholder="说明本次版本解决了哪些问题、完成了哪些需求。" required minLength={5} />
                    </label>
                    <label className="field">
                      <span className="label">包归档链接 <span className="required-mark">*</span><span className="hint">http(s) 地址</span></span>
                      <input className="input" name="archiveUrl" type="url" placeholder="https://packages.example.com/..." required />
                    </label>
                  </div>
                  <div className="form-note" style={{ marginTop: 11 }}>
                    提交后将自动发送到此软件包涉及的全部在行项目，并等待各项目安排集成测试。
                  </div>
                </ActionForm>
              )}
            </div>
          </section>
          <section className="card card-muted">
            <div className="card-body">
              <h3 style={{ fontSize: 13 }}>项目维度规则</h3>
              <div className="rule-list" style={{ marginTop: 10 }}>
                <div className="rule-item"><span className="rule-index">1</span><span className="note">同一版本会出现在所有使用该软件包的在行项目中。</span></div>
                <div className="rule-item"><span className="rule-index">2</span><span className="note">集成测试按项目独立组织，可同时安排多轮配套测试。</span></div>
                <div className="rule-item"><span className="rule-index">3</span><span className="note">全部项目完成测试后，版本才进入待发布试制。</span></div>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}
