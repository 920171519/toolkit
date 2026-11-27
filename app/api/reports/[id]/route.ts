import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getReadableTestReport } from "@/lib/batch-queries";
import { readReportFile, resolveReportPath } from "@/lib/report-storage";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await params;
  const reportId = Number(id);
  if (!Number.isInteger(reportId)) return new NextResponse("Not found", { status: 404 });
  const report = getReadableTestReport(user, reportId);
  if (!report) return new NextResponse("Not found", { status: 404 });
  const storagePath = resolveReportPath(report.storedPath);
  if (!storagePath) return new NextResponse("Not found", { status: 404 });
  try {
    const data = await readReportFile(storagePath, reportId);
    if (data === null) return new NextResponse("Not found", { status: 404 });
    return new NextResponse(data, {
      headers: {
        "Content-Type": report.mimeType,
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(report.originalName)}`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
