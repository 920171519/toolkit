"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { PublicProject } from "@/lib/queries";
import { Avatar, EmptyState } from "./ui";

function ContactLine({
  role,
  name,
  title,
  employeeId,
}: {
  role: string;
  name: string | null;
  title: string | null;
  employeeId: string | null;
}) {
  return (
    <div className="project-contact-line">
      <Avatar name={name ?? role} size="md" />
      <div className="project-contact-copy">
        <span className="project-contact-role">{role}</span>
        <span className="project-contact-name">{name ?? "待指定"}</span>
        <span className="project-contact-role">
          {title || "部门成员"}
          {employeeId ? ` · ${employeeId}` : ""}
        </span>
      </div>
    </div>
  );
}

export function ProjectContacts({ projects }: { projects: PublicProject[] }) {
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!normalized) return projects;
    return projects.filter((project) =>
      [
        project.name,
        project.pmName ?? "",
        project.pmEmployeeId ?? "",
        project.softwareManagerName ?? "",
        project.softwareManagerEmployeeId ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalized),
    );
  }, [projects, normalized]);

  return (
    <div id="project-contacts">
      <div className="toolbar-spread" style={{ marginBottom: 16, justifyContent: "flex-end" }}>
        <label
          className="input directory-search"
          style={{ display: "flex", alignItems: "center", gap: 8 }}
        >
          <Search size={14} style={{ color: "var(--muted-light)", flex: "none" }} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索项目、PM 或软件经理"
            aria-label="搜索项目联系人"
            style={{ border: 0, outline: 0, width: "100%", background: "transparent" }}
          />
        </label>
      </div>

      {filtered.length === 0 ? (
        <div className="card">
          <EmptyState
            title="没有匹配的项目联系人"
            description="可以尝试搜索项目名称、PM 姓名或软件经理姓名。"
          />
        </div>
      ) : (
        <div className="project-contact-grid">
          {filtered.map((project) => (
            <article className="card project-contact-card" key={project.id}>
              <h2>{project.name}</h2>
              <div className="project-contact-people">
                <ContactLine
                  role="PM"
                  name={project.pmName}
                  title={project.pmTitle}
                  employeeId={project.pmEmployeeId}
                />
                <ContactLine
                  role="软件经理"
                  name={project.softwareManagerName}
                  title={project.softwareManagerTitle}
                  employeeId={project.softwareManagerEmployeeId}
                />
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}