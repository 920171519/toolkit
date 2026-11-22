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
        ...project.pms.flatMap((person) => [person.name, person.employeeId, person.title]),
        ...project.softwareManagers.flatMap((person) => [person.name, person.employeeId, person.title]),
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalized),
    );
  }, [projects, normalized]);

  return (
    <div id="project-contacts">
      <div className="directory-search-bar" role="search">
        <label className="directory-search">
          <Search aria-hidden="true" />
          <input
            className="input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索项目、PM 或软件经理"
            aria-label="搜索项目联系人"
          />
        </label>
        <p className="small muted" role="status">{filtered.length} 个项目</p>
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
                {project.pms.map((person) => (
                  <ContactLine key={`pm-${person.id}`} role="PM" name={person.name} title={person.title} employeeId={person.employeeId} />
                ))}
                {project.pms.length === 0 && <ContactLine role="PM" name={null} title={null} employeeId={null} />}
                {project.softwareManagers.map((person) => (
                  <ContactLine key={`sm-${person.id}`} role="软件经理" name={person.name} title={person.title} employeeId={person.employeeId} />
                ))}
                {project.softwareManagers.length === 0 && <ContactLine role="软件经理" name={null} title={null} employeeId={null} />}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
