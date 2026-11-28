import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getReadableTestReport } from "@/lib/batch-queries";
import { readReportFile, resolveReportPath } from "@/lib/report-storage";
import { getTestReportMediaType } from "@/lib/test-report-validation";

const cacheHeaders = { "Cache-Control": "private, no-store" };

function reportNotFound() {
  return new NextResponse("Not found", { status: 404, headers: cacheHeaders });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401, headers: cacheHeaders });
  const { id } = await params;
  const reportId = Number(id);
  if (!Number.isInteger(reportId)) return reportNotFound();
  const report = getReadableTestReport(user, reportId);
  if (!report) return reportNotFound();
  const storagePath = resolveReportPath(report.storedPath);
  if (!storagePath) return reportNotFound();
  try {
    const data = await readReportFile(storagePath, reportId, report.expectedBytes);
    if (data === null) return reportNotFound();
    const mediaType = getTestReportMediaType(report.originalName, report.storedMediaType);
    const disposition = mediaType ? "inline" : "attachment";
    return new NextResponse(data, {
      headers: {
        "Content-Type": mediaType ?? "application/octet-stream",
        "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(report.originalName)}`,
        ...cacheHeaders,
      },
    });
  } catch {
    return reportNotFound();
  }
}
