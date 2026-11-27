import type { Metadata } from "next";
import Link from "next/link";
import { AlertCircle, ArrowRight, Bell, Plus } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { BINDING_FLOW_STATUS_META, PACKAGE_STATUS_META, ROLE_META, type PackageStatus } from "@/lib/constants";
import { formatDateTime, formatRelative } from "@/lib/format";
import { packageIdentity } from "@/lib/package-identity";
import { getTransferPackageOptions, parseFlash } from "@/lib/queries";
import { getTransferEntryGuidance } from "@/lib/transfer-guidance";
import { getPersonalDashboard, type PersonalAlert } from "@/lib/workflow-queries";
import { Badge, FlashMessage, PageHeader } from "@/components/ui";
import { GuidanceDialog } from "@/components/guidance-dialog";
import styles from "./dashboard.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "我的工作台" };

const categories = [
  { key: "alert", label: "异常处理" },
  { key: "approve", label: "待我审批" },
  { key: "bind", label: "绑定与节点确认" },
  { key: "test", label: "转测与集成测试" },
  { key: "manage", label: "试制与转正" },
] as const;

function NotificationItem({ item, alert = false }: { item: PersonalAlert; alert?: boolean }) {
  const next = new URLSearchParams({ key: item.key, next: item.href });
  const Icon = alert ? AlertCircle : Bell;
  return (
    <li>
      <a href={`/api/notifications/read?${next}`} className={`${styles.entry} ${alert ? "personal-alert" : "notification-link"}`}>
        <Icon size={17} aria-hidden="true" className={alert ? styles.alertIcon : styles.entryIcon} />
        <span className={styles.entryCopy}>
          <strong>{item.title}</strong>
          <span className={styles.entryMeta}>
            <span>{item.description}</span>
            {item.at && <time dateTime={item.at}>{formatRelative(item.at)}</time>}
          </span>
        </span>
        <ArrowRight size={15} aria-hidden="true" className={styles.entryIcon} />
      </a>
    </li>
  );
}

export default async function DashboardPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const notice = parseFlash(params.flash, params.tone === "error" ? "error" : "success");
  const { tasks, alerts, notifications, myVersions, myBindingFlows, counts } = getPersonalDashboard(user);
  const canSubmit = getTransferPackageOptions(user).length > 0;
  const groups = categories.map((category) => ({ ...category, tasks: tasks.filter((task) => task.category === category.key) }))
    .filter((category) => category.tasks.length > 0);
  const unread = counts.alerts + counts.notifications;
  const hasRecords = myVersions.length + myBindingFlows.length > 0;

  return (
    <>
      <PageHeader
        title="我的工作台"
        description={<span className={styles.accountInfo}>{user.name} · {ROLE_META[user.role].label}</span>}
        actions={canSubmit
          ? <Link prefetch={false} href="/submissions/transfer" className="button button-primary"><Plus size={16} aria-hidden="true" /> 提交转测申请</Link>
          : <GuidanceDialog label="提交转测申请" title="提交转测条件" items={getTransferEntryGuidance(user)} fallbackHref="/submissions/transfer" />}
      />
      <FlashMessage notice={notice} />

      {(unread > 0 || hasRecords) && (
        <nav className={styles.shortcuts} aria-label="工作台快捷跳转">
          {unread > 0 && <a href="#workbench-inbox">通知与提醒</a>}
          {myVersions.length > 0 && <a href="#workbench-versions">最近提交的版本</a>}
          {myBindingFlows.length > 0 && <a href="#workbench-bindings">我的绑定电子流</a>}
        </nav>
      )}

      <div className={styles.queueGrid} data-two-columns={unread > 0 || undefined}>
        <section className={`card ${styles.panel}`} id="workbench-tasks" aria-labelledby="tasks-title">
          <header className={styles.sectionHead}><h2 id="tasks-title">待我处理</h2>{tasks.length > 0 && <span>{tasks.length} 项</span>}</header>
          {groups.length === 0 ? (
            <div className={styles.empty}>
              <p>暂无待办</p>
              {!canSubmit && <Link prefetch={false} href="/overview" className={styles.textLink}>浏览项目 <ArrowRight size={13} aria-hidden="true" /></Link>}
            </div>
          ) : groups.map((group) => (
            <section key={group.key} className={styles.category} aria-labelledby={`tasks-${group.key}`}>
              <header className={styles.groupHead}><h3 id={`tasks-${group.key}`}>{group.label}</h3></header>
              <ul className={styles.entries}>
                {group.tasks.map((task) => (
                  <li key={task.key}>
                    <Link prefetch={false} href={task.href} className={`personal-task ${styles.entry}`}>
                      <span className={styles.entryCopy}><strong>{task.title}</strong><span>{task.description}</span></span>
                      <ArrowRight size={15} aria-hidden="true" className={styles.entryIcon} />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </section>

        {unread > 0 && (
          <section id="workbench-inbox" className={`card ${styles.panel}`} aria-labelledby="inbox-title">
            <header className={styles.sectionHead}><h2 id="inbox-title">通知与提醒</h2><span>{unread} 条未读</span></header>
            <ul className={styles.entries}>
              {alerts.map((alert) => <NotificationItem key={alert.key} item={alert} alert />)}
              {notifications.map((item) => <NotificationItem key={item.key} item={item} />)}
            </ul>
          </section>
        )}
      </div>

      {hasRecords && (
        <div className={styles.recordGrid} data-two-columns={(myVersions.length > 0 && myBindingFlows.length > 0) || undefined}>
          {myVersions.length > 0 && (
            <section className={`card ${styles.panel}`} id="workbench-versions" aria-labelledby="versions-title">
              <header className={styles.sectionHead}>
                <div className={styles.sectionTitle}>
                  <h2 id="versions-title">最近提交的版本</h2>
                  {counts.myActiveVersions > 0 && <span>{counts.myActiveVersions} 个在途</span>}
                </div>
                <Link prefetch={false} href="/versions" className={styles.textLink}>版本全链路 <ArrowRight size={13} aria-hidden="true" /></Link>
              </header>
              <ul className={styles.entries}>
                {myVersions.map((version) => {
                  const meta = PACKAGE_STATUS_META[version.status as PackageStatus];
                  const { code } = packageIdentity({ name: version.packageName, code: version.packageCode });
                  return (
                    <li key={version.id}>
                      <Link className={styles.entry} href={`/versions/${version.id}`} prefetch={false}>
                        <span className={styles.entryCopy}>
                          <strong>{code} <span className="mono">{version.version}</span></strong>
                          <span className={styles.entryMeta}>
                            {version.projectSummary && <span>{version.projectSummary}</span>}
                            <time dateTime={version.updatedAt}>{formatDateTime(version.updatedAt)}</time>
                          </span>
                        </span>
                        <Badge tone={meta?.tone ?? "slate"}>{meta?.label ?? version.status}</Badge>
                        <ArrowRight size={15} aria-hidden="true" className={styles.entryIcon} />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          {myBindingFlows.length > 0 && (
            <section className={`card ${styles.panel}`} id="workbench-bindings" aria-labelledby="bindings-title">
              <header className={styles.sectionHead}><h2 id="bindings-title">我的绑定电子流</h2></header>
              <ul className={styles.entries}>
                {myBindingFlows.map((flow) => {
                  const meta = BINDING_FLOW_STATUS_META[flow.status as keyof typeof BINDING_FLOW_STATUS_META];
                  const { code } = packageIdentity({ name: flow.packageName, code: flow.packageCode });
                  return (
                    <li key={flow.id}>
                      <Link className={styles.entry} href={`/trial/${flow.requestId}#binding-flow-${flow.id}`} prefetch={false}>
                        <span className={styles.entryCopy}>
                          <strong>{flow.flowNo}</strong>
                          <span>{code} {flow.version} · {flow.projectName}/{flow.nodeName}</span>
                          <span>{flow.barcodeCount} 个条码{flow.reviewComment && ` · ${flow.reviewComment}`}</span>
                        </span>
                        <Badge tone={meta?.tone ?? "slate"}>{meta?.label ?? flow.status}</Badge>
                        <ArrowRight size={15} aria-hidden="true" className={styles.entryIcon} />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>
      )}
    </>
  );
}
