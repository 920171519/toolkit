import type { Metadata } from "next";
import Link from "next/link";
import { LayoutGrid, SlidersHorizontal } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { canManageConfig } from "@/lib/permissions";
import { getProjectViews, parseFlash } from "@/lib/queries";
import { ProjectBoard } from "@/components/project-board";
import { FlashMessage, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "项目视图" };

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const notice = parseFlash(params.flash, params.tone === "error" ? "error" : "success");
  const projects = getProjectViews();
  const manager = canManageConfig(user);
  const activeCount = projects.filter((project) => project.status !== "ARCHIVED").length;
  const archivedCount = projects.length - activeCount;
  const group = params.group === "archived" ? "archived" : "active";
  const projectParam = Array.isArray(params.project) ? params.project[0] : params.project;
  const selectedProjectId = projectParam && Number.isInteger(Number(projectParam)) ? Number(projectParam) : null;

  return (
    <>
      <PageHeader
        eyebrow="Projects / Package usage"
        title="项目视图"
        description="按项目查看软件包版本与测试节点使用情况。项目结束后会移入存档项目，历史软件包使用情况仍可查阅。"
        actions={
          <>
            <Link href="/packages" className="button button-secondary">
              <LayoutGrid size={14} /> 按软件包查看
            </Link>
            {manager && (
              <Link href="/settings/projects" className="button button-primary">
                <SlidersHorizontal size={14} /> 配置项目
              </Link>
            )}
          </>
        }
      />
      <FlashMessage notice={notice} />

      <div className="info-strip" style={{ marginBottom: 16 }}>
        <span>
          在行项目 <strong>{activeCount}</strong>
        </span>
        <span>
          存档项目 <strong>{archivedCount}</strong>
        </span>
        <span style={{ marginLeft: "auto" }}>项目结束后可在项目配置中归档</span>
      </div>

      <ProjectBoard projects={projects} group={group} selectedProjectId={selectedProjectId} />
    </>
  );
}
