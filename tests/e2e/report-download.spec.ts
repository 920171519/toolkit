import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { login } from "./helpers";
import { getE2eReportsDirectory, openE2eDatabase } from "./storage";

test("验证报告的登录和读取失败响应均禁用缓存", async ({ page }) => {
  async function expectError(path: string, status: number, message: string) {
    const response = await page.request.get(path);
    expect(response.status(), path).toBe(status);
    expect(response.headers()["cache-control"], path).toBe("private, no-store");
    expect(await response.text(), path).toBe(message);
  }
  await expectError("/api/reports/unknown", 401, "Unauthorized");
  await login(page, "ADMIN001");
  await expectError("/api/reports/unknown", 404, "Not found");
  await expectError("/api/reports/9876543", 404, "Not found");

  const reportsDirectory = getE2eReportsDirectory();
  const storedName = `cache-errors-${randomUUID()}.txt`;
  const reportPath = join(reportsDirectory, storedName);
  const content = Buffer.from("旧验收报告");
  const database = openE2eDatabase();
  const ids: Array<number | bigint> = [];
  try {
    await mkdir(reportsDirectory, { recursive: true });
    await writeFile(reportPath, content, { flag: "wx" });
    const insert = database.prepare(
      `INSERT INTO report_files (original_name, stored_path, mime_type, size_bytes, created_at)
       VALUES (?, ?, 'text/plain', ?, datetime('now'))`,
    );
    for (const [name, storedPath] of [
      ["旧路径报告.txt", `historical-reports/${storedName}`],
      ["缺失报告.txt", `data/uploads/reports/missing-${storedName}`],
      // An old non-text filename fails during response construction after the file has been read.
      [Buffer.from("旧库二进制名称.txt"), `data/uploads/reports/${storedName}`],
    ] as const) {
      const id = insert.run(name, storedPath, content.length).lastInsertRowid;
      ids.push(id);
      await expectError(`/api/reports/${id}`, 404, "Not found");
    }
  } finally {
    try {
      const remove = database.prepare("DELETE FROM report_files WHERE id = ?");
      for (const id of ids) remove.run(id);
    } finally {
      database.close();
      await rm(reportPath, { force: true });
    }
  }
});

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

test("历史批次仅保存报告链接时沿用批次授权，未关联时允许上传人读取", async ({ page }) => {
  const reportsDirectory = getE2eReportsDirectory();
  const storedName = `legacy-url-${randomUUID()}.txt`;
  const reportPath = join(reportsDirectory, storedName);
  const content = Buffer.from("历史批次验收报告：验证通过。");
  const timestamp = "2026-11-07T01:00:00.000Z";
  const database = openE2eDatabase();
  let reportId: number | bigint | undefined;
  let batchId: number | bigint | undefined;

  try {
    await mkdir(reportsDirectory, { recursive: true });
    await writeFile(reportPath, content, { flag: "wx" });
    reportId = database.prepare(
      `INSERT INTO report_files (original_name, stored_path, mime_type, size_bytes, created_at, uploaded_by)
       VALUES (?, ?, 'text/plain; charset=utf-8', ?, ?, (SELECT id FROM users WHERE employee_id = 'MEMBER001'))`,
    ).run("历史验证报告.txt", `data/uploads/reports/${storedName}`, content.length, timestamp).lastInsertRowid;
    // Use the existing stored URL format independently of the production formatter.
    const reportHref = `/api/reports/${reportId}`;
    batchId = database.prepare(
      `INSERT INTO integration_batches (code, project_id, title, status, created_at, completed_at, conclusion, test_report_url)
       VALUES ('B99042', (SELECT id FROM projects WHERE code = 'N1'), '历史批次验收', 'COMPLETED', ?, ?, 'PASS', ?)`,
    ).run(timestamp, timestamp, reportHref).lastInsertRowid;

    await login(page, "TEST001");
    await page.goto(`/integration/${batchId}`);
    await expect(page.getByRole("link", { name: "测试验证报告" })).toHaveAttribute("href", reportHref);
    const sharedReport = await page.request.get(reportHref);
    expect(sharedReport.status()).toBe(200);
    expect(sharedReport.headers()["cache-control"]).toBe("private, no-store");
    expect(await sharedReport.body()).toEqual(content);

    await login(page, "MEMBER001");
    const deniedReport = await page.request.get(reportHref);
    expect(deniedReport.status()).toBe(404);
    expect(deniedReport.headers()["cache-control"]).toBe("private, no-store");
    expect(await deniedReport.text()).toBe("Not found");
    database.prepare("UPDATE integration_batches SET test_report_url = NULL WHERE id = ?").run(batchId);
    const ownReport = await page.request.get(reportHref);
    expect(ownReport.status()).toBe(200);
    expect(ownReport.headers()["cache-control"]).toBe("private, no-store");
    expect(await ownReport.body()).toEqual(content);
  } finally {
    try {
      if (batchId !== undefined) database.prepare("DELETE FROM integration_batches WHERE id = ?").run(batchId);
      if (reportId !== undefined) database.prepare("DELETE FROM report_files WHERE id = ?").run(reportId);
    } finally {
      database.close();
      await rm(reportPath, { force: true });
    }
  }
});
