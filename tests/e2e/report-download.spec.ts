import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { login } from "./helpers";
import { getE2eReportsDirectory, openE2eDatabase } from "./storage";

test("验证报告按原文件名返回类型并保留历史文本及下载内容", async ({ page }) => {
  await login(page, "ADMIN001");
  const reportsDirectory = getE2eReportsDirectory();
  const storedName = `content-type-${randomUUID()}.dat`;
  const storedPath = ["data", "uploads", "reports", storedName].join("\\");
  const reportPath = join(reportsDirectory, storedName);
  const content = Buffer.from("旧验证报告\n软件包验收通过。\n");
  const fixtures = [
    { name: "验证报告.PDF", contentType: "application/pdf" },
    { name: "验证报告.png", contentType: "image/png" },
    { name: "验证报告.JPG", contentType: "image/jpeg" },
    { name: "验证报告.jpeg", contentType: "image/jpeg" },
    { name: "验证报告.docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
    { name: "验证报告.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
    { name: "验证报告.zip", contentType: "application/zip" },
    { name: "无类型.txt", contentType: "text/plain; charset=utf-8", storedType: "" },
    { name: "旧库二进制类型.txt", contentType: "text/plain; charset=utf-8", storedType: Buffer.from("text/plain") },
    { name: "普通文本.txt", contentType: "text/plain", storedType: "text/plain" },
    { name: "旧文本.TXT", contentType: "text/plain; charset=GB18030", storedType: "text/plain; charset=GB18030" },
    { name: "旧版带引号.txt", contentType: 'text/plain; charset="GBK"', storedType: 'text/plain; charset="GBK"' },
    { name: "其他媒体类型.txt", contentType: "text/plain; charset=utf-8", storedType: "application/octet-stream" },
    { name: "多余文本参数.txt", contentType: "text/plain; charset=utf-8", storedType: "text/plain; format=flowed" },
    { name: "历史验证记录.log", contentType: "application/octet-stream", storedType: "text/plain", attachment: true },
    { name: "无后缀的旧报告", contentType: "application/octet-stream", storedType: "text/plain", attachment: true },
  ];

  const database = openE2eDatabase();
  try {
    await mkdir(reportsDirectory, { recursive: true });
    await writeFile(reportPath, content, { flag: "wx" });
    const insert = database.prepare(
      `INSERT INTO report_files (original_name, stored_path, mime_type, size_bytes, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    for (const { name, contentType, storedType, attachment } of fixtures) {
      const id = insert.run(name, storedPath, storedType ?? "application/octet-stream", content.length, new Date().toISOString()).lastInsertRowid;
      const response = await page.request.get(`/api/reports/${id}`);
      const headers = response.headers();
      expect(response.status(), name).toBe(200);
      expect(headers["content-type"], name).toBe(contentType);
      expect(headers["content-disposition"], name).toBe(`${attachment ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(name)}`);
      expect(headers["cache-control"], name).toBe("private, no-store");
      expect(headers["x-content-type-options"], name).toBe("nosniff");
      expect(await response.body(), name).toEqual(content);
    }
  } finally {
    try {
      database.prepare("DELETE FROM report_files WHERE stored_path = ?").run(storedPath);
    } finally {
      database.close();
      await rm(reportPath, { force: true });
    }
  }
});
