"use client";

import Link from "next/link";
import { ChevronRight, Search } from "lucide-react";
import { useState } from "react";
import type { ProjectConfig } from "@/lib/queries";

type ProjectNodes = Pick<ProjectConfig, "id" | "name" | "code" | "status"> & {
  configureHref?: string;
  nodes: Array<Pick<ProjectConfig["nodes"][number], "id" | "name" | "description">>;
};

export function PackageUsagePicker({ projects, defaultNodeIds, createProjectHref }: { projects: ProjectNodes[]; defaultNodeIds: number[]; createProjectHref?: string }) {
  const [search, setSearch] = useState("");
  const [chosen, setChosen] = useState(() => new Set(defaultNodeIds));
  const query = search.trim().toLowerCase();
  const matches = (value: string) => value.toLowerCase().includes(query);
  const descriptions = projects.map((project) => {
    const projectMatch = matches(`${project.name} ${project.code}`);
    const matchingNodes = new Set(project.nodes.filter((node) => projectMatch || matches(`${node.name} ${node.description}`)).map((node) => node.id));
    return { project, projectMatch, matchingNodes };
  });
  const hasLiveSelection = projects.some((project) => project.status !== "ARCHIVED" && project.nodes.some((node) => chosen.has(node.id)));

  return (
    <div className="settings-card-stack">
      <div className="toolbar settings-area-tools">
        <label className="field settings-filter-search">
          <span className="sr-only">查找项目节点</span>
          <span className="input package-search-input"><Search size={16} aria-hidden="true" />
            <input type="search" placeholder="项目名称、编码或节点名称" value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) event.preventDefault(); }} />
          </span>
        </label>
        <span className="small muted" aria-live="polite">已选择 {chosen.size} 个节点</span>
      </div>
      {!hasLiveSelection && <p className="small muted" role="status">至少选择一个在行项目的节点后，才能提交此软件包的转测申请。</p>}
      <div className="settings-usage-projects">
        {descriptions.map(({ project, projectMatch, matchingNodes }) => {
          const selected = project.nodes.filter((node) => chosen.has(node.id)).length;
          return (
            <details className="settings-usage-project" key={project.id} open={(query && matchingNodes.size > 0) || selected > 0} hidden={!projectMatch && matchingNodes.size === 0}>
              <summary><ChevronRight size={15} className="settings-usage-chevron" aria-hidden="true" /><strong>{project.name}</strong><span className="small muted">{project.code}</span>{project.status === "ARCHIVED" && <span className="small muted">已归档</span>}<span className="small muted">{selected}/{project.nodes.length} 已选</span></summary>
              <div className="check-grid">
                {project.nodes.map((node) => (
                  <label className="check-item" key={node.id} hidden={!matchingNodes.has(node.id)}>
                    <input type="checkbox" name="nodeIds" value={node.id} checked={chosen.has(node.id)} onChange={(event) => {
                      const enabled = event.target.checked;
                      setChosen((current) => {
                        const next = new Set(current);
                        if (enabled) next.add(node.id);
                        else next.delete(node.id);
                        return next;
                      });
                    }} />
                    <span>{node.name}{node.description && <small className="muted">{node.description}</small>}</span>
                  </label>
                ))}
                {project.nodes.length === 0 && (
                  <div className="small muted">
                    暂无测试节点。{project.configureHref
                      ? <Link href={project.configureHref} prefetch={false}>前往添加节点</Link>
                      : "可联系该项目的软件经理添加。"}
                  </div>
                )}
              </div>
            </details>
          );
        })}
        {descriptions.length === 0 ? <p className="small muted">尚未创建项目。{createProjectHref
          ? <Link href={createProjectHref} prefetch={false}>前往创建项目</Link>
          : "请联系管理员创建项目。"}</p> :
          query && !descriptions.some(({ projectMatch, matchingNodes }) => projectMatch || matchingNodes.size) && <p className="small muted" role="status">没有匹配的项目或节点</p>}
      </div>
    </div>
  );
}
