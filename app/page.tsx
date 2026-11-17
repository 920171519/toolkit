import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { DEPARTMENT_NAME } from "@/lib/constants";
import { getPublicProjects } from "@/lib/queries";
import { PublicHeader } from "@/components/public-header";
import { ProjectContacts } from "@/components/project-contacts";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "项目联系人 · 软件工程部",
  description: "查看软件工程部在行项目的 PM 与软件经理联系方式。",
};

export default async function HomePage() {
  const [projects, user] = await Promise.all([Promise.resolve(getPublicProjects()), getCurrentUser()]);

  return (
    <>
      <PublicHeader user={user} />
      <main>
        <section className="contact-hero">
          <div className="container-wide">
            <div className="eyebrow">Project contacts / {DEPARTMENT_NAME}</div>
            <h1>项目联系人</h1>
            <p>每个项目可以配置多位 PM 和软件经理。需要跨部门协作时，请联系对应项目的 PM 或软件经理。</p>
          </div>
        </section>

        <section className="public-section-tight" style={{ paddingTop: 34 }}>
          <div className="container-wide">
            <ProjectContacts projects={projects} />          </div>
        </section>
      </main>
      <footer className="public-footer">
        <div className="container-wide public-footer-inner">
          <span>工程协同台 · {DEPARTMENT_NAME}</span>
          <span>项目接口请联系对应 PM 或软件经理</span>
        </div>
      </footer>
    </>
  );
}