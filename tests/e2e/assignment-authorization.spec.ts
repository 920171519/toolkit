import { expect, test, type Page } from "@playwright/test";
import { expectFlash, login } from "./helpers";
import { openE2eDatabase } from "./storage";

const n1Settings = "/settings/projects/1";

async function setN1Manager(admin: Page, assigned: boolean) {
  await admin.goto(n1Settings);
  await admin.getByTestId("edit-project-trigger").click();
  const form = admin.getByTestId("edit-project-form-1");
  const managers = form.getByRole("group", { name: /^软件经理/ });
  await managers.getByRole("searchbox").fill("TEST002");
  const candidate = managers.getByRole("checkbox", { name: /何欣/ });
  if ((await candidate.isChecked()) === assigned) return;
  await candidate.setChecked(assigned);
  await form.getByRole("button", { name: "保存项目配置" }).click();
  await expectFlash(admin, "项目配置已更新");
}

test("普通账号可同时承担两个项目的不同分工，撤销指派后即时收回权限", async ({ browser, page }) => {
  await login(page, "ADMIN001");
  const context = await browser.newContext();
  const staff = await context.newPage();
  try {
    await login(staff, "TEST002");
    await expect(staff.locator(".sidebar-user-role")).toContainText("普通账号");
    await staff.goto("/integration/4?project=1");
    await expect(staff.getByRole("heading", { name: "页面或记录不存在", exact: true })).toBeVisible();
    await staff.goto("/integration/5?project=2");
    await expect(staff.getByRole("button", { name: "提交测试结论" })).toBeVisible();

    await setN1Manager(page, true);
    await staff.goto(n1Settings);
    await expect(staff.getByRole("heading", { name: "星云 N1", level: 1 })).toBeVisible();
    await staff.getByTestId("edit-project-trigger").click();
    const form = staff.getByTestId("edit-project-form-1");
    await expect(form.getByLabel("项目阶段", { exact: true })).toBeVisible();
    await expect(form.locator('input[name="softwareManagerIds"]')).toHaveCount(0);
    await form.getByRole("button", { name: "保存项目配置" }).click();
    await expectFlash(staff, "项目配置已更新");

    await staff.goto("/integration/4?project=1");
    await expect(staff.getByRole("heading", { level: 1, name: /B120/ })).toBeVisible();
    await expect(staff.getByRole("button", { name: "提交测试结论" })).toHaveCount(0);
    await staff.goto("/integration/5?project=2");
    await expect(staff.getByRole("button", { name: "提交测试结论" })).toBeVisible();

    await setN1Manager(page, false);
    await staff.goto("/integration/4?project=1");
    await expect(staff.getByRole("heading", { name: "页面或记录不存在", exact: true })).toBeVisible();
    await staff.goto("/integration/5?project=2");
    await expect(staff.getByRole("button", { name: "提交测试结论" })).toBeVisible();
  } finally {
    try {
      await setN1Manager(page, false);
    } finally {
      await context.close();
    }
  }
});

test("无项目分工的普通账号可以看项目目录，直接流程与抽屉链接仍按业务范围校验", async ({ page }) => {
  await login(page, "MEMBER001");
  await page.goto("/overview");
  await expect(page.getByRole("link", { name: /星云 N1/ })).toBeVisible();
  for (const path of ["/submissions?project=1", "/integration/4", "/trial/32?project=1"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "页面或记录不存在", exact: true })).toBeVisible();
  }
  expect((await page.request.get("/api/packages/1?project=1")).status()).toBe(404);
  await page.goto("/submissions/transfer?package=1");
  const guidance = page.getByRole("region", { name: "转测提交条件" });
  await expect(guidance).toContainText("软件包不可用");
  await expect(guidance).not.toContainText("系统底座");

  await login(page, "OWNER001");
  expect((await page.request.get("/api/packages/1?project=1")).status()).toBe(200);
  expect((await page.request.get("/api/packages/3?project=1")).status()).toBe(404);
});

test("共享转正确认同步范围，同时只展开有权项目的原始证据", async ({ page }) => {
  await login(page, "MGR001");
  await page.goto("/formal?project=1&q=1004NET");
  await page.getByRole("link", { name: "核对并转正", exact: true }).click();
  const evidence = page.getByRole("region", { name: "项目验收与绑定证据" });
  for (const project of ["星云 N1", "极光 M2", "磐石 T3"]) {
    await expect(evidence.getByText(project, { exact: true })).toBeVisible();
  }
  await expect(evidence.getByRole("link", { name: "查看绑定验证记录" })).toHaveCount(1);
  await expect(evidence.getByRole("link", { name: "查看绑定验证记录" })).toHaveAttribute("href", /project=1/);
  await page.getByRole("button", { name: "发布正式版本", exact: true }).click();
  await expect(page.getByRole("dialog", { name: /转正 1004NET/ })).toContainText("星云 N1、极光 M2、磐石 T3 将同步使用该正式版本");
});

test("版本追溯隐藏最新草稿的批次字段，仍保留项目申请和可读历史", async ({ page }) => {
  await login(page, "MGR001");
  const db = openE2eDatabase();
  db.exec("PRAGMA foreign_keys = ON");
  const draftCode = "E2E-TRACE-LATEST-DRAFT";
  try {
    const prior = db.prepare(
      `SELECT bi.id AS itemId, bi.package_version_id AS versionId, b.project_id AS projectId
       FROM batch_items bi JOIN integration_batches b ON b.id = bi.batch_id
       WHERE b.code = 'B119' AND bi.transfer_request_id IS NOT NULL`,
    ).get() as { itemId: number; versionId: number; projectId: number };
    const draft = db.prepare(
      `INSERT INTO integration_batches (code, project_id, title, status, created_at)
       VALUES (?, ?, '版本追溯草稿权限验证', 'DRAFT', '2026-11-28T00:00:00Z')`,
    ).run(draftCode, prior.projectId);
    const snapshot = db.prepare(
      `INSERT INTO batch_items (batch_id, package_id, package_version_id, version, archive_url, transfer_request_id)
       SELECT ?, package_id, package_version_id, version, archive_url, transfer_request_id FROM batch_items WHERE id = ?`,
    ).run(draft.lastInsertRowid, prior.itemId);
    expect(snapshot.changes).toBe(1);

    const href = `/versions/${prior.versionId}?project=${prior.projectId}`;
    const request = page.getByRole("region", { name: "项目版本证据表格" }).getByRole("row", { name: /星云 N1/ });
    const history = page.getByRole("region", { name: "集成测试证据表格" });
    await page.goto(href);
    await expect(request.getByRole("link", { name: draftCode, exact: true })).toBeVisible();

    await login(page, "TEST001");
    await page.goto(href);
    await expect(request.getByText("无关联批次", { exact: true })).toBeVisible();
    await expect(history.getByRole("link", { name: "B119", exact: true })).toBeVisible();
    await expect(history.getByText(draftCode, { exact: true })).toHaveCount(0);
  } finally {
    try {
      db.prepare("DELETE FROM integration_batches WHERE code = ?").run(draftCode);
    } finally {
      db.close();
    }
  }
});

test("项目活动、节点绑定和转正核对按项目分工展示批次证据", async ({ page }) => {
  await login(page, "MGR001");
  const db = openE2eDatabase();
  db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  const packageId = (db.prepare("SELECT id FROM packages WHERE name = '1004NET'").get() as { id: number }).id;
  const projectId = (db.prepare("SELECT id FROM projects WHERE code = 'N1'").get() as { id: number }).id;
  const versions: number[] = [];
  const batches: number[] = [];
  const stamp = "2026-12-01T00:00:00.000Z";
  const createFixture = (version: string, status: "TRIAL" | "PENDING_FORMAL", batchCode: string) => {
    const versionId = Number(db.prepare(
      `INSERT INTO package_versions
         (package_id, version, change_summary, archive_url, status, binding_mode, trial_released_at, submitted_at, updated_at)
       VALUES (?, ?, '批次证据展示回归', 'https://example.com/archive/batch-evidence', ?, 'PUSHED', ?, ?, ?)`,
    ).run(packageId, version, status, stamp, stamp, stamp).lastInsertRowid);
    versions.push(versionId);
    const requestId = Number(db.prepare(
      `INSERT INTO version_transfer_requests
         (package_version_id, project_id, status, integration_status, trial_released_at, submitted_at, updated_at)
       VALUES (?, ?, ?, 'PASSED', ?, ?, ?)`,
    ).run(versionId, projectId, status, stamp, stamp, stamp).lastInsertRowid);
    const batchId = Number(db.prepare(
      "INSERT INTO integration_batches (code, project_id, title, status, created_at) VALUES (?, ?, '批次证据展示回归', 'DRAFT', ?)",
    ).run(batchCode, projectId, stamp).lastInsertRowid);
    batches.push(batchId);
    db.prepare(
      `INSERT INTO batch_items (batch_id, package_id, package_version_id, version, archive_url, transfer_request_id)
       VALUES (?, ?, ?, ?, 'https://example.com/archive/batch-evidence', ?)`,
    ).run(batchId, packageId, versionId, version, requestId);
    return { versionId, requestId, batchId };
  };

  try {
    const bindingVersion = "2.0.0-evidence-binding";
    const bindingDraftCode = "QA-BINDING-DRAFT";
    const formalDraftCode = "QA-FORMAL-DRAFT";
    const binding = createFixture(bindingVersion, "TRIAL", bindingDraftCode);
    const formal = createFixture("2.0.0-evidence-formal", "PENDING_FORMAL", formalDraftCode);
    const activityHref = `/projects/${projectId}`;
    const queueHref = `/trial?project=${projectId}&view=binding`;
    const detailHref = `/trial/${binding.requestId}?project=${projectId}`;
    const formalHref = `/formal/${formal.versionId}?project=${projectId}`;
    const activity = page.getByRole("region", { name: "版本流程记录" }).getByRole("listitem").filter({ hasText: bindingVersion });
    const queue = page.getByRole("region", { name: "试制版本绑定验证表格" });
    const bindingRow = queue.getByRole("row").filter({ hasText: bindingVersion });
    const batchFilter = queue.getByRole("button", { name: "筛选转测批次", exact: true });
    const batchMenu = page.getByRole("dialog", { name: "筛选转测批次", exact: true });
    const formalEvidence = page.getByRole("region", { name: "项目验收与绑定证据" });
    const filterBindingBatch = async () => {
      await batchFilter.click();
      await batchMenu.getByRole("combobox", { name: "转测批次匹配方式", exact: true }).selectOption("exact");
      await batchMenu.getByRole("textbox", { name: "转测批次", exact: true }).fill(bindingDraftCode);
      await batchMenu.getByRole("button", { name: "应用", exact: true }).click();
      await expect(page).toHaveURL(/f_binding_batch=QA-BINDING-DRAFT/);
    };

    await page.goto(activityHref);
    await expect(activity).toContainText(bindingDraftCode);
    await page.goto(queueHref);
    await expect(bindingRow.getByRole("link", { name: bindingDraftCode })).toBeVisible();
    await filterBindingBatch();
    await expect(bindingRow).toBeVisible();
    await page.goto(detailHref);
    await page.getByRole("link", { name: new RegExp(bindingDraftCode) }).click();
    await expect(page.getByRole("heading", { name: new RegExp(bindingDraftCode) })).toBeVisible();
    await page.goto(formalHref);
    await expect(formalEvidence.getByRole("link", { name: new RegExp(formalDraftCode) })).toBeVisible();

    await login(page, "TEST001");
    await page.goto(activityHref);
    await expect(activity).toBeVisible();
    await expect(activity).not.toContainText(bindingDraftCode);
    await page.goto(queueHref);
    await expect(bindingRow).toBeVisible();
    await expect(bindingRow).not.toContainText(bindingDraftCode);
    await expect(bindingRow).not.toContainText("风险发布");
    await filterBindingBatch();
    await expect(bindingRow).toHaveCount(0);
    await page.goto(detailHref);
    await expect(page.getByText("集成测试通过", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: new RegExp(bindingDraftCode) })).toHaveCount(0);
    await expect(page.getByRole("main")).not.toContainText(bindingDraftCode);
    await page.goto(formalHref);
    await expect(formalEvidence.getByRole("link", { name: "查看绑定验证记录" })).toBeVisible();
    await expect(formalEvidence.getByRole("link", { name: new RegExp(formalDraftCode) })).toHaveCount(0);
    await expect(formalEvidence).not.toContainText(formalDraftCode);
    await page.goto(`/integration?project=${projectId}&view=history`);
    await page.getByRole("link", { name: /B119/ }).click();
    await expect(page.getByRole("heading", { name: /B119/ })).toBeVisible();

    db.prepare("UPDATE integration_batches SET status = 'IN_TEST', sent_at = ? WHERE id = ?").run(stamp, binding.batchId);
    await page.goto(queueHref);
    await expect(bindingRow.getByRole("link", { name: bindingDraftCode, exact: true })).toBeVisible();
    await filterBindingBatch();
    await expect(bindingRow).toBeVisible();
  } finally {
    try {
      for (const batch of batches) db.prepare("DELETE FROM integration_batches WHERE id = ?").run(batch);
      for (const version of versions) db.prepare("DELETE FROM package_versions WHERE id = ?").run(version);
    } finally {
      db.close();
    }
  }
});

test("历史跨项目关联按批次所属项目展示，试制资格与占用状态保留", async ({ page }) => {
  await login(page, "MGR001");
  const db = openE2eDatabase();
  db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  const [n1, m2] = db.prepare("SELECT id FROM projects WHERE code IN ('N1','M2') ORDER BY sort_order").all() as { id: number }[];
  const stamp = "2026-12-01T00:00:00.000Z";
  const archive = "https://example.com/archive/qa-association";
  const summary = "已发起批次的验收细节";
  const report = "https://example.com/reports/qa-association";
  const packageCode = "QA-ASSOC";
  const versionNumbers = { ready: "1.2.3-legacy-ready", pending: "1.2.4-legacy-pending" };
  const historicalCode = "QA-ASSOC-HISTORY";
  const latestCode = "QA-ASSOC-LATEST";
  const draftCode = "QA-ASSOC-DRAFT";
  let packageId: number | undefined;
  const batches: number[] = [];
  try {
    packageId = Number(db.prepare("INSERT INTO packages (name, code, created_at) VALUES ('历史批次关联测试包', ?, ?)").run(packageCode, stamp).lastInsertRowid);
    db.prepare(
      "INSERT INTO package_usages (package_id, project_id, node_id) SELECT ?, ?, id FROM project_nodes WHERE project_id = ? AND name = 'EVT'",
    ).run(packageId, n1.id, n1.id);
    const addRequest = (version: string, passed: boolean) => {
      const versionId = Number(db.prepare(
        `INSERT INTO package_versions (package_id, version, change_summary, archive_url, status, submitted_at, updated_at)
         VALUES (?, ?, '历史关联回归', ?, ?, ?, ?)`,
      ).run(packageId!, version, archive, passed ? "PENDING_TRIAL" : "PENDING_TRANSFER", stamp, stamp).lastInsertRowid);
      const status = passed ? "PASSED" : "PENDING";
      const requestId = Number(db.prepare(
        `INSERT INTO version_transfer_requests (package_version_id, project_id, status, integration_status, submitted_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(versionId, n1.id, status, status, stamp, stamp).lastInsertRowid);
      return { versionId, requestId, version };
    };
    const addBatch = (code: string, projectId: number, request: ReturnType<typeof addRequest>, status: "DRAFT" | "COMPLETED") => {
      const completed = status === "COMPLETED";
      const id = Number(db.prepare(
        `INSERT INTO integration_batches (code, project_id, title, status, created_at, completed_at, sent_at,
          conclusion, test_summary, test_report_url) VALUES (?, ?, '历史关联回归', ?, ?, ?, ?, ?, ?, ?)`,
      ).run(code, projectId, status, stamp, completed ? stamp : null, completed ? stamp : null,
        completed ? "PASS" : null, completed ? summary : null, completed ? report : null).lastInsertRowid);
      batches.push(id);
      db.prepare(
        `INSERT INTO batch_items (batch_id, package_id, package_version_id, version, archive_url, transfer_request_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(id, packageId!, request.versionId, request.version, archive, request.requestId);
      return id;
    };

    const ready = addRequest(versionNumbers.ready, true);
    const pending = addRequest(versionNumbers.pending, false);
    addBatch(historicalCode, n1.id, ready, "COMPLETED");
    const latestBatch = addBatch(latestCode, m2.id, ready, "COMPLETED");
    const reservedDraft = addBatch(draftCode, m2.id, pending, "DRAFT");
    const traceHref = `/versions/${ready.versionId}`;
    const pendingTraceHref = `/versions/${pending.versionId}?project=${n1.id}`;
    const queueHref = `/trial?project=${n1.id}`;
    const readyHref = `/trial/ready/${ready.requestId}?project=${n1.id}`;
    const submissionsHref = `/submissions?project=${n1.id}&q=${packageCode}`;
    const traceRow = page.getByRole("region", { name: "项目版本证据表格" }).getByRole("row", { name: /星云 N1/ });
    const history = page.getByRole("region", { name: "集成测试证据表格" });
    const queuedRow = page.getByRole("region", { name: "待发布试制表格" }).getByRole("row").filter({ hasText: ready.version });
    const review = page.getByRole("region", { name: "验收结论" });
    const pendingRow = page.getByRole("region", { name: "星云 N1待转测申请表格" }).getByRole("row").filter({ hasText: pending.version });

    await page.goto(traceHref);
    await expect(traceRow.getByText("无关联批次")).toBeVisible();
    await expect(history.getByRole("link", { name: historicalCode, exact: true })).toBeVisible();
    await expect(history.getByText(latestCode, { exact: true })).toHaveCount(0);

    await page.goto(queueHref);
    await expect(queuedRow).toContainText("待发试制");
    await expect(queuedRow).not.toContainText(latestCode);
    await queuedRow.getByRole("link", { name: "详情", exact: true }).click();
    await expect(page).toHaveURL(readyHref);
    await expect(review.getByText("通过", { exact: true })).toBeVisible();
    await expect(review.getByRole("link", { name: "验证报告", exact: true })).toHaveCount(0);
    await expect(review).not.toContainText(summary);
    await page.getByRole("button", { name: "发布", exact: true }).click();
    const publish = page.getByRole("dialog", { name: new RegExp(`发布 ${packageCode}`) });
    await expect(publish.getByRole("button", { name: "发布全项目共享试制版本", exact: true })).toBeVisible();
    await expect(publish).not.toContainText(latestCode);
    await expect(publish).not.toContainText(summary);

    await page.goto(pendingTraceHref);
    await page.getByRole("button", { name: "发布试制", exact: true }).click();
    const guidance = page.getByRole("dialog", { name: "试制发布条件", exact: true });
    await expect(guidance.getByRole("link", { name: "查看转测申请", exact: true })).toBeVisible();
    await expect(guidance).not.toContainText(draftCode);

    await page.goto(submissionsHref);
    await expect(pendingRow.getByText("草稿占用", { exact: true })).toBeVisible();
    await expect(pendingRow.getByRole("checkbox")).toHaveCount(0);
    await expect(pendingRow.getByRole("link", { name: new RegExp(draftCode) })).toHaveCount(0);

    await login(page, "ADMIN001");
    await page.goto(traceHref);
    await expect(traceRow.getByRole("link", { name: latestCode, exact: true })).toHaveAttribute("href", `/integration/${latestBatch}?project=${m2.id}`);
    await page.goto(`${traceHref}?project=${n1.id}`);
    await expect(traceRow.getByText("无关联批次")).toBeVisible();
    await expect(history.getByRole("link", { name: historicalCode, exact: true })).toBeVisible();

    await page.goto(readyHref);
    await expect(review.getByRole("link", { name: latestCode, exact: true })).toHaveAttribute("href", `/integration/${latestBatch}?project=${m2.id}`);
    await expect(review.getByRole("link", { name: "验证报告", exact: true })).toHaveAttribute("href", report);
    await expect(review.getByText(summary, { exact: true })).toBeVisible();

    await page.goto(submissionsHref);
    await expect(pendingRow.getByRole("link", { name: new RegExp(draftCode) })).toHaveAttribute("href", new RegExp(`^/integration/${reservedDraft}\\?project=${m2.id}(?:&|$)`));
    await expect(pendingRow.getByRole("checkbox")).toHaveCount(0);
  } finally {
    try {
      for (const batch of batches) db.prepare("DELETE FROM integration_batches WHERE id = ?").run(batch);
      if (packageId !== undefined) db.prepare("DELETE FROM packages WHERE id = ?").run(packageId);
    } finally {
      db.close();
    }
  }
});

test("风险登记隐藏历史批次编号，旧表单仍检查最新关联", async ({ page }) => {
  await login(page, "MGR001");
  const db = openE2eDatabase();
  db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  const [n1, m2] = db.prepare("SELECT id FROM projects WHERE code IN ('N1','M2') ORDER BY sort_order").all() as { id: number }[];
  const stamp = "2026-12-01T00:00:00.000Z";
  const archive = "https://example.com/archive/risk-freshness";
  const version = "1.2.3-risk-freshness";
  let packageId: number | undefined;
  const batches: number[] = [];
  try {
    const id = Number(db.prepare(
      "INSERT INTO packages (name, code, created_at) VALUES ('风险登记回归包', 'QA-RISK-FRESHNESS', ?)",
    ).run(stamp).lastInsertRowid);
    packageId = id;
    db.prepare(
      "INSERT INTO package_usages (package_id, project_id, node_id) SELECT ?, ?, id FROM project_nodes WHERE project_id = ? AND name = 'EVT'",
    ).run(id, n1.id, n1.id);
    const versionId = Number(db.prepare(
      `INSERT INTO package_versions (package_id, version, change_summary, archive_url, submitted_at, updated_at)
       VALUES (?, ?, '风险登记回归', ?, ?, ?)`,
    ).run(id, version, archive, stamp, stamp).lastInsertRowid);
    const requestId = Number(db.prepare(
      "INSERT INTO version_transfer_requests (package_version_id, project_id, submitted_at, updated_at) VALUES (?, ?, ?, ?)",
    ).run(versionId, n1.id, stamp, stamp).lastInsertRowid);
    const addHistoricalBatch = (code: string) => {
      const batchId = Number(db.prepare(
        "INSERT INTO integration_batches (code, project_id, title, status, created_at) VALUES (?, ?, '历史终止记录', 'TERMINATED', ?)",
      ).run(code, m2.id, stamp).lastInsertRowid);
      batches.push(batchId);
      db.prepare(
        `INSERT INTO batch_items (batch_id, package_id, package_version_id, version, archive_url, transfer_request_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(batchId, id, versionId, version, archive, requestId);
      return batchId;
    };
    const originalBatch = addHistoricalBatch("QA-RISK-HISTORY-A");
    const href = `/submissions?project=${n1.id}&q=${version}`;
    const row = page.getByRole("row").filter({ hasText: version });
    const dialog = page.getByRole("dialog", { name: "登记风险试制原因", exact: true });
    const open = async () => {
      await row.getByRole("button", { name: "登记风险原因", exact: true }).click();
      await dialog.getByRole("textbox", { name: "风险试制原因", exact: true }).fill("演示环境验证历史关联更新后的登记。");
    };
    const submit = dialog.getByRole("button", { name: "纳入待发布试制", exact: true });
    const admission = () => db.prepare("SELECT batch_id AS batchId FROM trial_risk_admissions WHERE request_id = ?").get(requestId);
    const response = await page.goto(href);
    const document = await response!.text();
    expect(document).not.toMatch(/\\?"riskEntry\\?"\s*:/);
    expect(document).not.toMatch(new RegExp(`\\\\?"batchId\\\\?"\\s*:\\s*${originalBatch}\\b`));
    await open();
    await expect(dialog.locator('input[name="batchId"]')).toHaveCount(0);

    const replacementBatch = addHistoricalBatch("QA-RISK-HISTORY-B");
    await submit.click();
    await expect(dialog.getByRole("alert")).toContainText("转测状态已变化，请刷新页面并按当前阶段登记风险原因。");
    expect(admission()).toBeUndefined();

    await page.goto(href);
    await open();
    await submit.click();
    await expectFlash(page, "风险试制原因已登记，版本已纳入待发布试制");
    expect(admission()).toMatchObject({ batchId: replacementBatch });
  } finally {
    try {
      for (const batchId of batches) db.prepare("DELETE FROM integration_batches WHERE id = ?").run(batchId);
      if (packageId !== undefined) db.prepare("DELETE FROM packages WHERE id = ?").run(packageId);
    } finally {
      db.close();
    }
  }
});

test("仅负责归档项目的软件经理保留配置和历史读取权限", async ({ page }) => {
  await login(page, "MEMBER001");
  const db = openE2eDatabase();
  const archivedProjectId = 4;
  let inserted = false;
  try {
    const result = db.prepare(
      `INSERT INTO project_software_managers (project_id, user_id, created_at)
       SELECT ?, id, datetime('now') FROM users WHERE employee_id = 'MEMBER001'`,
    ).run(archivedProjectId);
    inserted = result.changes === 1;
    expect(inserted).toBe(true);

    await page.goto("/dashboard");
    await expect(page.getByRole("complementary", { name: "主导航" }).getByRole("link", { name: "项目配置", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "待我处理" })).toContainText("暂无待办");
    await page.goto("/settings/projects");
    const settings = page.getByRole("table");
    await expect(settings.getByRole("row").filter({ hasText: "远山 X0" })).toBeVisible();
    await expect(settings).not.toContainText("星云 N1");

    await page.goto(`/integration?project=${archivedProjectId}`);
    await expect(page.getByRole("heading", { name: "历史批次", exact: true })).toBeVisible();
    await page.goto("/submissions");
    await expect(page.getByRole("navigation", { name: "转测工作队列" })).toHaveCount(0);
    await page.goto("/trial");
    await expect(page.getByRole("navigation", { name: "试制与绑定队列" })).toHaveCount(0);
  } finally {
    try {
      if (inserted) db.prepare(
        `DELETE FROM project_software_managers WHERE project_id = ?
         AND user_id = (SELECT id FROM users WHERE employee_id = 'MEMBER001')`,
      ).run(archivedProjectId);
    } finally {
      db.close();
    }
  }
});
