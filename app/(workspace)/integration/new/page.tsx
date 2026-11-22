import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { requireWorkflowProject } from "@/lib/project-scope";
import { workflowHref } from "@/lib/workflow-links";

export default async function NewBatchPage({ searchParams }: { searchParams: Promise<{ project?: string | string[] }> }) {
  const user = await requireUser();
  const project = requireWorkflowProject(user, (await searchParams).project);
  redirect(workflowHref("/submissions", project?.id));
}
