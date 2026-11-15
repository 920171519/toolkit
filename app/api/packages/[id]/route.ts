import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canEditPackageById } from "@/lib/access";
import { getPackageDetail } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
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
  const data = getPackageDetail(packageId, true);
  if (!data) {
    return NextResponse.json({ error: "软件包不存在。" }, { status: 404 });
  }
  return NextResponse.json(
    {
      ...data,
      canEdit: canEditPackageById(user, packageId),
    },
    {
      headers: { "Cache-Control": "no-store" },
    },
  );
}
