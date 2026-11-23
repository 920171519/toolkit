import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { one } from "@/lib/db";
import { resolveReportPath } from "@/lib/report-storage";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await params;
  const reportId = Number(id);
  if (!Number.isInteger(reportId)) return new NextResponse("Not found", { status: 404 });
  const report = one<{ original_name: string; stored_path: string; mime_type: string }>(
    "SELECT original_name, stored_path, mime_type FROM report_files WHERE id = ?",
    reportId,
  );
  if (!report) return new NextResponse("Not found", { status: 404 });
  const storagePath = resolveReportPath(report.stored_path);
  if (!storagePath) return new NextResponse("Not found", { status: 404 });
  try {
    const data = await readFile(storagePath);
    return new NextResponse(data, {
      headers: {
        "Content-Type": report.mime_type,
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(report.original_name)}`,
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
