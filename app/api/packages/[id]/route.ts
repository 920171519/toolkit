import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getPackageDrawerData } from "@/lib/package-queries";
import { getReadablePackageProject } from "@/lib/project-scope";

export const dynamic = "force-dynamic";

const cacheHeaders = { "Cache-Control": "no-store" };

function packageError(status: 400 | 401 | 404, error: string) {
  return NextResponse.json({ error }, { status, headers: cacheHeaders });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return packageError(401, "请先登录。");
  }
  const { id } = await params;
  const packageId = Number(id);
  if (!Number.isInteger(packageId)) {
    return packageError(400, "软件包参数无效。");
  }
  const scope = new URL(request.url).searchParams.getAll("project");
  const project = scope.length === 1
    ? getReadablePackageProject(user, scope[0])
    : undefined;
  if (scope.length > 0 && !project) {
    return packageError(404, "项目不存在或不可查看。");
  }
  const data = getPackageDrawerData(user, packageId, project?.id);
  if (!data) {
    return packageError(404, "软件包不存在。");
  }
  return NextResponse.json(data, { headers: cacheHeaders });
}
