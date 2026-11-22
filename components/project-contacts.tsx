"use client";

import { useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import styles from "@/app/public-contacts.module.css";
import type { ProjectContact, PublicProject } from "@/lib/queries";
import { EmptyState } from "./ui";

const pageSize = 12;

function normalize(value: string) {
  return value.normalize("NFKC").toLowerCase();
}

function ContactGroup({ role, people }: { role: string; people: ProjectContact[] }) {
  return (
    <div className={styles.contactGroup}>
      <dt>{role}</dt>
      <dd>
        {people.length === 0 ? <span className={styles.secondary}>未分配</span> : (
          <ul className={styles.people}>
            {people.map((person) => (
              <li key={person.id}>
                <span className={styles.personName}>{person.name}</span>
                <span className={styles.secondary}>{[person.title !== role && person.title, person.employeeId].filter(Boolean).join(" · ")}</span>
              </li>
            ))}
          </ul>
        )}
      </dd>
    </div>
  );
}

export function ProjectContacts({ projects }: { projects: PublicProject[] }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const searchInput = useRef<HTMLInputElement>(null);
  const directory = useRef<HTMLElement>(null);
  const index = useMemo(() => projects.map((project) => ({
    project,
    terms: normalize([
      project.name,
      project.code,
      ...[...project.pms, ...project.softwareManagers].flatMap((person) => [person.name, person.employeeId, person.title]),
    ].join(" ")),
  })), [projects]);
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  const filtered = index.filter((entry) => terms.every((term) => entry.terms.includes(term)));
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const offset = (currentPage - 1) * pageSize;
  const visible = filtered.slice(offset, offset + pageSize);

  function changeSearch(value: string) {
    setQuery(value);
    setPage(1);
  }

  function changePage(nextPage: number) {
    setPage(nextPage);
    directory.current?.focus();
  }

  return (
    <section ref={directory} tabIndex={-1} id="project-contacts" aria-label="在行项目联系人">
      <div className={styles.searchBar} role="search" aria-label="查找公开联系人">
        <div className={styles.searchControl}>
          <Search size={17} aria-hidden="true" />
          <input
            className="input"
            ref={searchInput}
            type="search"
            value={query}
            onChange={(event) => changeSearch(event.target.value)}
            placeholder="项目名称、代号、姓名或工号"
            aria-label="搜索项目联系人"
            maxLength={100}
          />
          {query && (
            <button type="button" className={styles.clear} onClick={() => {
              changeSearch("");
              searchInput.current?.focus();
            }} aria-label="清除搜索">
              <X size={16} aria-hidden="true" />
            </button>
          )}
        </div>
        <p className={styles.resultCount} role="status">{filtered.length} 个项目</p>
      </div>

      {visible.length === 0 ? (
        <div className="card">
          <EmptyState
            title={terms.length > 0 ? "没有匹配的项目联系人" : "暂无在行项目"}
          />
        </div>
      ) : (
        <div className={styles.grid}>
          {visible.map(({ project }) => (
            <article className={`card project-contact-card ${styles.project}`} key={project.id}>
              <h2>{project.name}</h2>
              {!normalize(project.name).split(/\s+/).includes(normalize(project.code)) && <span className={styles.secondary}>{project.code}</span>}
              <dl className={styles.contactGroups}>
                <ContactGroup role="PM" people={project.pms} />
                <ContactGroup role="软件经理" people={project.softwareManagers} />
              </dl>
            </article>
          ))}
        </div>
      )}
      {pageCount > 1 && (
        <nav className={styles.pagination} aria-label="项目联系人分页">
          <button type="button" className="button button-secondary" disabled={currentPage === 1} onClick={() => changePage(currentPage - 1)}>
            <ChevronLeft size={15} aria-hidden="true" /> 上一页
          </button>
          <span aria-live="polite">第 {currentPage} / {pageCount} 页</span>
          <button type="button" className="button button-secondary" disabled={currentPage === pageCount} onClick={() => changePage(currentPage + 1)}>
            下一页 <ChevronRight size={15} aria-hidden="true" />
          </button>
        </nav>
      )}
    </section>
  );
}
