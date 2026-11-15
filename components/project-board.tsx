"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Archive, ArrowUpRight, Boxes, CalendarClock, UserRound } from "lucide-react";
import type { ProjectView } from "@/lib/queries";
import { PROJECT_STATUS_META } from "@/lib/constants";
import { Avatar, Badge, EmptyState, StatusPill } from "@/components/ui";

type ProjectGroup = "active" | "archived";

export function ProjectBoard({ projects }: { projects: ProjectView[] }) {
  const activeProjects = useMemo(
    () => projects.filter((project) => project.status !== "ARCHIVED"),
    [projects],
  );
  const archivedProjects = useMemo(
    () => projects.filter((project) => project.status === "ARCHIVED"),
    [projects],
  );
  const [group, setGroup] = useState<ProjectGroup>(activeProjects.length > 0 ? "active" : "archived");
  const [selectedId, setSelectedId] = useState<number>(
    activeProjects[0]?.id ?? archivedProjects[0]?.id ?? 0,
  );

  const projectsInGroup = group === "active" ? activeProjects : archivedProjects;
  const selected =
    projectsInGroup.find((project) => project.id === selectedId) ?? projectsInGroup[0];

  if (projects.length === 0) {
    return <EmptyState title="暂无项目" description="管理员添加项目后，会显示在这里。" />;
  }

  return (
    <div>
      <div className="project-view-switch">
        <div className="stage-tabs">
          <button
            type="button"
            className="stage-tab"
            data-active={group === "active"}
            onClick={() => {
              setGroup("active");
              setSelectedId(activeProjects[0]?.id ?? 0);
            }}
          >
            在行项目
          </button>
          <button
            type="button"
            className="stage-tab"
            data-active={group === "archived"}
            onClick={() => {
              setGroup("archived");
              setSelectedId(archivedProjects[0]?.id ?? 0);
            }}
          >
            存档项目
          </button>
        </div>
        {projectsInGroup.length > 0 && (
          <label className="project-select">
            <span>选择项目</span>
            <select
              value={selected?.id ?? ""}
              onChange={(event) => setSelectedId(Number(event.target.value))}
              aria-label="选择项目"
            >
              {projectsInGroup.map((project) => (
                <option value={project.id} key={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {!selected ? (
        <div className="card">
          <EmptyState
            title={group === "archived" ? "暂无存档项目" : "暂无在行项目"}
            description={
              group === "archived"
                ? "项目结束后可在项目配置中归档，历史软件包情况会保留在这里。"
                : "管理员创建项目后，会显示在这里。"
            }
          />
        </div>
      ) : (
        <>
          <section className="card" style={{ marginBottom: 16 }}>
            <div className="card-body" style={{ padding: 20 }}>
              <div className="toolbar-spread">
                <div className="toolbar" style={{ gap: 12 }}>
                  <span
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 11,
                      background: group === "archived" ? "var(--surface-muted)" : "var(--brand-soft)",
                      color: group === "archived" ? "var(--muted)" : "var(--brand)",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {group === "archived" ? <Archive size={20} /> : <Boxes size={20} />}
                  </span>
                  <div>
                    <div className="toolbar" style={{ gap: 8 }}>
                      <h2 style={{ fontSize: 24 }}>{selected.name}</h2>
                      <span className="chip">{selected.code}</span>
                      <Badge tone={PROJECT_STATUS_META[selected.status].tone} dot>
                        {PROJECT_STATUS_META[selected.status].label}
                      </Badge>
                    </div>
                    <p className="small muted" style={{ marginTop: 4 }}>{selected.description}</p>
                  </div>
                </div>
                <div className="project-view-contacts">
                  <div className="project-contact-line compact">
                    <Avatar name={selected.pmName ?? "PM"} size="sm" />
                    <div className="project-contact-copy">
                      <span className="project-contact-role">PM</span>
                      <span className="project-contact-name">{selected.pmName ?? "待指定"}</span>
                    </div>
                  </div>
                  <div className="project-contact-line compact">
                    <Avatar name={selected.softwareManagerName ?? "软件经理"} size="sm" />
                    <div className="project-contact-copy">
                      <span className="project-contact-role">软件经理</span>
                      <span className="project-contact-name">
                        {selected.softwareManagerName ?? "待指定"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="info-strip" style={{ marginTop: 16 }}>
                <span className="toolbar" style={{ gap: 6 }}>
                  <CalendarClock size={12} />
                  测试节点
                  <strong>{selected.nodes.map((node) => node.name).join(" / ") || "未配置"}</strong>
                </span>
                <span>
                  节点说明{" "}
                  <strong>
                    {selected.nodes
                      .map((node) => (node.description ? `${node.name} ${node.description}` : node.name))
                      .join(" · ") || "—"}
                  </strong>
                </span>
                {group === "archived" && (
                  <span className="archive-note">
                    <Archive size={12} /> 项目已归档，仅供历史查看
                  </span>
                )}
              </div>
            </div>
          </section>

          <section className="card">
            <div className="card-header">
              <div>
                <h2 style={{ fontSize: 18 }}>项目软件包版本</h2>
                <p className="small muted" style={{ marginTop: 3 }}>
                  {group === "archived"
                    ? "存档项目保留结束时的软件包使用范围与版本情况。"
                    : "本项目各测试节点使用的软件包及当前版本状态。"}
                </p>
              </div>
              {group === "active" && (
                <span className="chip">
                  <UserRound size={10} /> 项目成员请联系 PM
                </span>
              )}
            </div>
            <div className="card-body" style={{ padding: 0, marginTop: 13 }}>
              {selected.packages.length === 0 ? (
                <EmptyState
                  title="项目尚未关联软件包"
                  description="请联系软件经理在软件包配置中维护项目使用范围。"
                />
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>软件包</th>
                        <th>责任人</th>
                        <th>使用节点</th>
                        <th>正式版本</th>
                        <th>试制版本</th>
                        <th>在途版本</th>
                        <th aria-label="操作" />
                      </tr>
                    </thead>
                    <tbody>
                      {selected.packages.map((pkg) => (
                        <tr key={pkg.id}>
                          <td>
                            <Link href={`/packages?open=${pkg.id}`} style={{ fontWeight: 600 }}>
                              {pkg.name}
                            </Link>
                            <div className="small muted">{pkg.code}</div>
                          </td>
                          <td>
                            <span className="small">{pkg.ownerName ?? "待指定"}</span>
                          </td>
                          <td>
                            <div className="project-nodes" style={{ marginTop: 0 }}>
                              {pkg.nodeNames.map((node) => (
                                <span className="chip" key={node}>{node}</span>
                              ))}
                            </div>
                          </td>
                          <td>
                            {pkg.formalVersion ? (
                              <span className="version-badge" style={{ color: "var(--brand)" }}>
                                {pkg.formalVersion}
                              </span>
                            ) : (
                              <span className="small muted">—</span>
                            )}
                          </td>
                          <td>
                            {pkg.trialVersion ? (
                              <span className="version-badge" style={{ color: "var(--teal)" }}>
                                {pkg.trialVersion}
                              </span>
                            ) : (
                              <span className="small muted">—</span>
                            )}
                          </td>
                          <td>
                            {pkg.currentVersion ? (
                              <div className="toolbar" style={{ gap: 6 }}>
                                <span className="version-badge">{pkg.currentVersion}</span>
                                {pkg.currentStatus && <StatusPill status={pkg.currentStatus} />}
                              </div>
                            ) : (
                              <span className="small muted">—</span>
                            )}
                          </td>
                          <td className="cell-actions">
                            <Link href={`/packages?open=${pkg.id}`} className="archive-link">
                              详情 <ArrowUpRight size={12} />
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>

          <div className="muted-panel" style={{ marginTop: 14 }}>
            <strong style={{ color: "var(--ink-soft)" }}>项目维度说明：</strong>
            同一个软件包可能被多个项目的多个测试节点使用。试制绑定验证只覆盖在行项目；存档项目仅用于历史追溯。
          </div>
        </>
      )}
    </div>
  );
}