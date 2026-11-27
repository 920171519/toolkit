import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { getPublicProjects } from "@/lib/project-queries";
import { PublicHeader } from "@/components/public-header";
import { ProjectContacts } from "@/components/project-contacts";
import styles from "./public-contacts.module.css";

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
      <main className={`container-wide ${styles.page}`}>
        <header className={styles.heading}>
          <h1>在行项目联系人</h1>
        </header>
        <ProjectContacts projects={projects} />
      </main>
    </>
  );
}
