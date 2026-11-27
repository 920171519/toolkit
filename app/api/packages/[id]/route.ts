import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canEditPackageById } from "@/lib/access";
import { getReadablePackageDetail } from "@/lib/queries";
import { getReadablePackageProject } from "@/lib/project-scope";
import { getPackageDeactivationBlockingVersions } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "请先登录。" }, { status: 401 });
  }
  const { id } = await params;
  const packageId = Number(id);
  if (!Number.isInteger(packageId)) {
    return NextResponse.json({ error: "软件包参数无效。" }, { status: 400 });
  }
  const scope = new URL(request.url).searchParams.getAll("project");
  const project = scope.length === 1
    ? getReadablePackageProject(user, Number(scope[0]))
    : undefined;
  if (scope.length > 0 && !project) {
    return NextResponse.json({ error: "项目不存在或不可查看。" }, { status: 404 });
  }
  const data = getReadablePackageDetail(user, packageId, project?.id);
  if (!data) {
    return NextResponse.json({ error: "软件包不存在。" }, { status: 404 });
  }
  const canEdit = canEditPackageById(user, packageId);
  return NextResponse.json(
    {
      ...data,
      canEdit,
      deactivationBlockers: canEdit ? getPackageDeactivationBlockingVersions(packageId) : [],
    },
    {
      headers: { "Cache-Control": "no-store" },
    },
  );
}
