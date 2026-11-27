import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getPackageDrawerData } from "@/lib/package-queries";
import { getReadablePackageProject } from "@/lib/project-scope";

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
  const data = getPackageDrawerData(user, packageId, project?.id);
  if (!data) {
    return NextResponse.json({ error: "软件包不存在。" }, { status: 404 });
  }
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
