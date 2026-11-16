import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  FlaskConical,
  Inbox,
  Link2,
  UserCheck,
} from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getPersonalDashboard } from "@/lib/workflow-queries";
import { PACKAGE_STATUS_META, BINDING_FLOW_STATUS_META, type PackageStatus } from "@/lib/constants";
import { formatDateTime, formatRelative } from "@/lib/format";
import { parseFlash } from "@/lib/queries";
import { Badge, EmptyState, FlashMessage, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "我的工作台" };

const categoryMeta = {
  approve: { label: "待我审批", icon: UserCheck, tone: "rose" },
  bind: { label: "待我绑定", icon: Link2, tone: "teal" },
  test: { label: "测试安排", icon: FlaskConical, tone: "sky" },
  manage: { label: "流程处理", icon: ClipboardCheck, tone: "amber" },
  alert: { label: "异常处理", icon: AlertTriangle, tone: "rose" },
} as const;

function notificationReadHref(key: string, next: string) {
  return `/api/notifications/read?key=${encodeURIComponent(key)}&next=${encodeURIComponent(next)}`;
}

const alertTone: Record<string, string> = {
  danger: "rose",
  warning: "amber",
  success: "emerald",
  info: "sky",
};

function greeting() {
  const hour = Number(
    new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", hour12: false }).format(new Date()),
  );
  if (hour < 9) return "早上好";
  if (hour < 12) return "上午好";
  if (hour < 14) return "中午好";
  if (hour < 18) return "下午好";
  return "晚上好";
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const notice = parseFlash(params.flash, params.tone === "error" ? "error" : "success");
  const data = getPersonalDashboard(user);
  const groupedTasks = (Object.keys(categoryMeta) as Array<keyof typeof categoryMeta>).map((category) => ({
    category,
    meta: categoryMeta[category],
    items: data.tasks.filter((task) => task.category === category),
  })).filter((group) => group.items.length > 0);

  return (
    <>
      <PageHeader
        eyebrow="My workspace / 个人工作台"
        title={`${greeting()}，${user.name}`}
        description="这里只展示与你有关、需要你处理或关注的事项。转测申请按项目分发，测试异常、绑定任务与绑定电子流审批会主动出现在这里。"
        actions={
          <>
            <Link prefetch={false} href="/overview" className="button button-secondary">部门总览</Link>
            <Link prefetch={false} href="/submissions" className="button button-primary">提交转测申请 <ArrowRight size={14} /></Link>
          </>
        }
      />
      <FlashMessage notice={notice} />

      <div className="metric-row">
        <div className="metric">
          <div className="metric-label">待我处理</div>
          <div className="metric-value">{data.counts.tasks}</div>
          <div className="metric-note">绑定、审批与流程安排</div>
        </div>
        <div className="metric">
          <div className="metric-label">异常提醒</div>
          <div className="metric-value" style={{ color: data.counts.alerts > 0 ? "var(--danger)" : undefined }}>
            {data.counts.alerts}
          </div>
          <div className="metric-note">测试异常、审批驳回与待撤销电子流</div>
        </div>
        <div className="metric">
          <div className="metric-label">我提交的在途版本</div>
          <div className="metric-value">{data.counts.myActiveVersions}</div>
          <div className="metric-note">尚未转正或作废</div>
        </div>
        <div className="metric">
          <div className="metric-label">审批通知</div>
          <div className="metric-value">{data.counts.notifications}</div>
          <div className="metric-note">我提交的绑定电子流结果</div>
        </div>
      </div>

      {data.alerts.length > 0 && (
        <section className="card" style={{ marginTop: 18, borderColor: "#eccfc8" }}>
          <div className="card-header">
            <div>
              <div className="eyebrow" style={{ color: "var(--danger)" }}>Attention required</div>
              <h2 style={{ fontSize: 18, marginTop: 5 }}>需要立即关注</h2>
            </div>
            <Badge tone="rose">{data.alerts.length} 项</Badge>
          </div>
          <div className="card-body" style={{ paddingTop: 10 }}>
            <div className="personal-alert-list">
              {data.alerts.map((alert) => (
                <a href={notificationReadHref(alert.key, alert.href)} className="personal-alert" key={alert.key}>
                  <AlertTriangle size={16} style={{ color: alert.tone === "danger" ? "var(--danger)" : "var(--warning)", flex: "none", marginTop: 2 }} />
                  <div style={{ flex: 1 }}>
                    <div className="personal-task-title">{alert.title}</div>
                    <div className="personal-task-desc">{alert.description}</div>
                    {alert.at && <div className="personal-task-meta">{formatRelative(alert.at)}</div>}
                  </div>
                  <Badge tone={alertTone[alert.tone] ?? "slate"}>{alert.tone === "danger" ? "异常" : alert.tone === "warning" ? "关注" : "通知"}</Badge>
                </a>
              ))}
            </div>
          </div>
        </section>
      )}

      <div className="two-col" style={{ marginTop: 18 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <section className="card">
            <div className="card-header">
              <div>
                <h2 style={{ fontSize: 18 }}>待我处理</h2>
                <p className="small muted" style={{ marginTop: 3 }}>
                  按绑定、审批和流程安排归类，点击直接进入处理页面。
                </p>
              </div>
              <Inbox size={18} style={{ color: "var(--muted-light)" }} />
            </div>
            <div className="card-body" style={{ paddingTop: 10 }}>
              {groupedTasks.length === 0 ? (
                <EmptyState title="当前没有待处理任务" description="新的转测申请、绑定任务或审批事项会自动出现在这里。" />
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                  {groupedTasks.map((group) => {
                    const Icon = group.meta.icon;
                    return (
                      <div key={group.category}>
                        <div className="split-row" style={{ marginBottom: 8 }}>
                          <div className="toolbar" style={{ gap: 7 }}>
                            <Icon size={14} style={{ color: "var(--brand)" }} />
                            <span style={{ fontSize: 13, fontWeight: 600 }}>{group.meta.label}</span>
                          </div>
                          <Badge tone={group.meta.tone}>{group.items.length}</Badge>
                        </div>
                        <div className="personal-task-list">
                          {group.items.map((task) => (
                            <Link prefetch={false} href={task.href} className="personal-task" key={task.key}>
                              <div style={{ flex: 1 }}>
                                <div className="personal-task-title">{task.title}</div>
                                <div className="personal-task-desc">{task.description}</div>
                              </div>
                              {task.meta && <span className="chip">{task.meta}</span>}
                              <ArrowRight size={14} style={{ color: "var(--muted-light)", flex: "none" }} />
                            </Link>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          <section className="card">
            <div className="card-header">
              <div>
                <h2 style={{ fontSize: 18 }}>我提交的版本</h2>
                <p className="small muted" style={{ marginTop: 3 }}>
                  关注自己提交的软件包在各项目中的测试进度。
                </p>
              </div>
              <Link prefetch={false} href="/packages" className="archive-link">版本总览 <ArrowRight size={11} /></Link>
            </div>
            <div className="card-body" style={{ paddingTop: 8 }}>
              {data.myVersions.length === 0 ? (
                <p className="muted small">你还没有提交过软件包版本。</p>
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>软件包</th>
                        <th>版本</th>
                        <th>项目状态</th>
                        <th>当前状态</th>
                        <th>更新时间</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.myVersions.map((version) => {
                        const meta = PACKAGE_STATUS_META[version.status as PackageStatus];
                        return (
                          <tr key={version.id}>
                            <td>
                              <Link prefetch={false} href={`/packages?open=${version.packageId}`} style={{ fontWeight: 600 }}>
                                {version.packageName}
                              </Link>
                            </td>
                            <td><span className="version-badge">{version.version}</span></td>
                            <td className="cell-wrap"><span className="small muted">{version.projectSummary || "—"}</span></td>
                            <td>{meta ? <Badge tone={meta.tone} dot>{meta.label}</Badge> : <Badge tone="slate">{version.status}</Badge>}</td>
                            <td className="small muted">{formatDateTime(version.updatedAt)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        </div>

        <aside style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <section className="card">
            <div className="card-header">
              <div>
                <h2 style={{ fontSize: 16 }}>我的绑定电子流</h2>
                <p className="small muted" style={{ marginTop: 2 }}>审批结果会在这里通知</p>
              </div>
              <Link2 size={16} style={{ color: "var(--muted-light)" }} />
            </div>
            <div className="card-body" style={{ paddingTop: 10 }}>
              {data.myBindingFlows.length === 0 ? (
                <p className="muted small">暂无绑定电子流。</p>
              ) : (
                <div className="side-list">
                  {data.myBindingFlows.slice(0, 6).map((flow) => {
                    const meta = BINDING_FLOW_STATUS_META[flow.status as keyof typeof BINDING_FLOW_STATUS_META];
                    return (
                      <div className="side-list-item" key={flow.id}>
                        <CheckCircle2 size={14} style={{ color: flow.status === "REJECTED" ? "var(--danger)" : flow.status === "APPROVED" ? "var(--brand)" : "var(--warning)", marginTop: 3 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="split-row">
                            <span style={{ fontSize: 12, fontWeight: 600 }}>{flow.flowNo}</span>
                            {meta && <Badge tone={meta.tone}>{meta.label}</Badge>}
                          </div>
                          <div className="personal-task-desc">
                            {flow.packageName} {flow.version} · {flow.projectName}/{flow.nodeName}
                          </div>
                          <div className="personal-task-meta">条码 {flow.barcodes.join("、") || "—"}{flow.reviewComment ? ` · ${flow.reviewComment}` : ""}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          {data.notifications.length > 0 && (
            <section className="card card-muted">
              <div className="card-header">
                <div>
                  <h2 style={{ fontSize: 16 }}>最新通知</h2>
                </div>
              </div>
              <div className="card-body" style={{ paddingTop: 8 }}>
                <div className="side-list">
                  {data.notifications.slice(0, 5).map((item) => (
                    <a className="side-list-item notification-link" href={notificationReadHref(item.key, item.href)} key={item.key}>
                      <span className="timeline-dot" style={{ background: item.tone === "danger" ? "var(--danger)" : "var(--brand)", flex: "none" }} />
                      <div>
                        <div className="personal-task-title">{item.title}</div>
                        <div className="personal-task-desc">{item.description}</div>
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            </section>
          )}

          <section className="card card-muted">
            <div className="card-body">
              <h3 style={{ fontSize: 13 }}>流程提示</h3>
              <div className="rule-list" style={{ marginTop: 10 }}>
                <div className="rule-item"><span className="rule-index">1</span><span className="note">转测申请提交后会同步到该软件包涉及的全部在行项目。</span></div>
                <div className="rule-item"><span className="rule-index">2</span><span className="note">试制版本发布后，各项目节点绑定责任人会收到待绑定任务。</span></div>
                <div className="rule-item"><span className="rule-index">3</span><span className="note">绑定电子流审批通过数量满足节点要求后，版本自动进入待转正。</span></div>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}
