import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test as base, type Page } from "@playwright/test";
import { confirmAction, expectFlash, login } from "./helpers";

function createSample(db: DatabaseSync, suffix: number, projects: number[], packages: number[]) {
  const code = `98${suffix}TQA`;
  const version = `7.51.${suffix}`;
  const name = `试制资格回归组件 ${suffix}`;
  const archive = "https://packages.example.com/trial-eligibility";
  const packageId = Number(db.prepare(
    `INSERT INTO packages (name, code, area_id, owner_id, created_at)
     SELECT ?, ?, area_id, owner_id, datetime('now') FROM packages WHERE name = '1002CFG'`,
  ).run(name, code).lastInsertRowid);
  packages.push(packageId);
  const versionId = Number(db.prepare(
    `INSERT INTO package_versions (package_id, version, change_summary, archive_url, status, submitted_at, updated_at)
     VALUES (?, ?, '验证集成测试通过后的试制准入', ?, 'IN_TEST', datetime('now'), datetime('now'))`,
  ).run(packageId, version, archive).lastInsertRowid);
  const batches = projects.map((projectId, index) => {
    db.prepare(
      `INSERT INTO package_usages (package_id, project_id, node_id)
       SELECT ?, ?, id FROM project_nodes WHERE project_id = ? ORDER BY id LIMIT 1`,
    ).run(packageId, projectId, projectId);
    const requestId = Number(db.prepare(
      `INSERT INTO version_transfer_requests
         (package_version_id, project_id, status, integration_status, submitted_at, updated_at)
       VALUES (?, ?, 'IN_TEST', 'IN_TEST', datetime('now'), datetime('now'))`,
    ).run(versionId, projectId).lastInsertRowid);
    const batchId = Number(db.prepare(
      `INSERT INTO integration_batches (code, project_id, title, status, created_at, sent_at)
       VALUES (?, ?, ?, 'IN_TEST', datetime('now'), datetime('now'))`,
    ).run(`B9${suffix}${index}`, projectId, name).lastInsertRowid);
    db.prepare(
      `INSERT INTO batch_items
         (batch_id, package_id, package_version_id, version, archive_url, is_changed, transfer_request_id)
       VALUES (?, ?, ?, ?, ?, 1, ?)`,
    ).run(batchId, packageId, versionId, version, archive, requestId);
    return batchId;
  });
  return { version, versionId, packageId, batches, code, name };
}

type TrialSample = ReturnType<typeof createSample>;

const test = base.extend<{
  trialData: {
    db: DatabaseSync;
    create: (suffix: number, projects: number[]) => TrialSample;
    addArchivedProject: (packageId: number) => number;
  };
}>({
  trialData: async ({ page }, provide) => {
    await login(page, "ADMIN001");
    const db = new DatabaseSync(resolve(process.env.TOOLKIT_QA_DB ?? "data/e2e.db"));
    db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    const packages: number[] = [];
    const archivedProjects: number[] = [];
    try {
      await provide({
        db,
        create: (suffix, projects) => createSample(db, suffix, projects, packages),
        addArchivedProject: (packageId) => {
          const projectId = Number(db.prepare(
            `INSERT INTO projects (name, code, status, created_at)
             VALUES ('试制资格归档项目', 'TRIALQA', 'ARCHIVED', datetime('now'))`,
          ).run().lastInsertRowid);
          archivedProjects.push(projectId);
          db.prepare(
            `INSERT INTO project_pms (project_id, user_id, created_at)
             SELECT ?, pm_user_id, datetime('now') FROM projects WHERE id = 1`,
          ).run(projectId);
          db.prepare(
            `INSERT INTO project_software_managers (project_id, user_id, created_at)
             SELECT ?, software_manager_id, datetime('now') FROM projects WHERE id = 1`,
          ).run(projectId);
          const nodeId = db.prepare("INSERT INTO project_nodes (project_id, name) VALUES (?, 'EVT')").run(projectId).lastInsertRowid;
          db.prepare("INSERT INTO package_usages (package_id, project_id, node_id) VALUES (?, ?, ?)").run(packageId, projectId, nodeId);
          return projectId;
        },
      });
    } finally {
      try {
        const batches = db.prepare(
          `SELECT DISTINCT b.id, b.test_report_file_id AS reportId
           FROM integration_batches b JOIN batch_items bi ON bi.batch_id = b.id WHERE bi.package_id = ?`,
        );
        for (const packageId of packages) {
          for (const batch of batches.all(packageId)) {
            db.prepare("DELETE FROM audit_logs WHERE entity_type = 'BATCH' AND entity_id = ?").run(batch.id);
            db.prepare("DELETE FROM integration_batches WHERE id = ?").run(batch.id);
            if (batch.reportId !== null) db.prepare("DELETE FROM report_files WHERE id = ?").run(batch.reportId);
          }
          db.prepare(
            `DELETE FROM audit_logs WHERE (entity_type = 'PACKAGE' AND entity_id = ?)
              OR (entity_type = 'PACKAGE_VERSION' AND entity_id IN (SELECT id FROM package_versions WHERE package_id = ?))`,
          ).run(packageId, packageId);
          db.prepare("DELETE FROM packages WHERE id = ?").run(packageId);
        }
        for (const projectId of archivedProjects) {
          db.prepare("DELETE FROM audit_logs WHERE entity_type = 'PROJECT' AND entity_id = ?").run(projectId);
          db.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
        }
      } finally {
        db.close();
      }
    }
  },
});

async function submitPassingConclusion(page: Page, batchId: number, tester: string) {
  await login(page, tester);
  await page.goto(`/integration/${batchId}`);
  await page.getByRole("button", { name: "提交测试结论", exact: true }).click();
  const form = page.getByTestId("complete-test-form");
  await form.locator('select[name="conclusion"]').selectOption("PASS");
  await form.locator('textarea[name="testSummary"]').fill("集成测试用例均已通过，验证报告记录了本轮配套结果。");
  await form.locator('input[name="reportFile"]').setInputFiles({
    name: "trial-eligibility.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("PASS"),
  });
  await form.getByRole("button", { name: "提交验证结论" }).click();
  await expectFlash(page, "验证报告已上传");
}

async function expectTrialState(page: Page, sample: TrialSample, state: "待发试制" | "待其他项目验收" | "待补转测申请") {
  await page.goto(`/packages?project=1&q=${sample.version}`);
  const packageRow = page.getByRole("row").filter({ hasText: sample.code });
  await expect(packageRow).toContainText(state);
  if (state !== "待发试制") await expect(packageRow).not.toContainText("待发试制");

  await page.goto(`/trial?project=1&view=release&release_q=${sample.version}`);
  const row = page.getByRole("region", { name: "待发布试制表格" }).getByRole("row").filter({ hasText: sample.version });
  await expect(row).toHaveCount(state === "待发试制" ? 1 : 0);
  if (state === "待发试制") await expect(row).toContainText(state);
}

async function setProjectArchiveState(page: Page, projectId: number, status: "ACTIVE" | "ARCHIVED") {
  await page.goto(`/settings/projects/${projectId}?edit=project`);
  const form = page.getByTestId(`edit-project-form-${projectId}`);
  await form.getByLabel("流程状态", { exact: true }).selectOption(status);
  await form.getByRole("button", { name: "保存项目配置" }).click();
  await expectFlash(page, "项目配置已更新");
}

test("单项目集成测试通过后立即进入待发布试制", async ({ page, trialData }) => {
  const sample = trialData.create(31, [1]);
  await submitPassingConclusion(page, sample.batches[0], "TEST001");
  await login(page, "MGR001");
  await expectTrialState(page, sample, "待发试制");
});

test("共享版本等最后一个在行项目通过后自动进入待发布试制", async ({ page, trialData }) => {
  const sample = trialData.create(32, [1, 3]);
  await submitPassingConclusion(page, sample.batches[0], "TEST001");
  await login(page, "MGR001");
  await expectTrialState(page, sample, "待其他项目验收");

  await login(page, "ADMIN001");
  await page.goto(`/trial?project=1&release_q=${sample.version}`);
  await page.getByRole("link", { name: "按版本检查试制条件" }).click();
  await page.getByRole("row").filter({ hasText: sample.code }).getByRole("link", { name: sample.version, exact: true }).click();
  await page.getByRole("button", { name: "发布试制", exact: true }).click();
  const guidance = page.getByRole("dialog", { name: "试制发布条件" });
  await expect(guidance).toContainText("磐石 T3 · 等待集成测试结论");
  await expect(guidance.getByRole("link", { name: "查看转测批次" })).toHaveAttribute("href", `/integration/${sample.batches[1]}?project=3`);

  await submitPassingConclusion(page, sample.batches[1], "TEST003");
  await login(page, "MGR001");
  await expectTrialState(page, sample, "待发试制");
});

test("新增使用项目时补建一条转测申请，并保留原项目的结论和报告", async ({ page, trialData }) => {
  const sample = trialData.create(33, [1]);
  await submitPassingConclusion(page, sample.batches[0], "TEST001");
  const requestEvidence = trialData.db.prepare(
    `SELECT r.id, r.status, r.integration_status, b.conclusion, b.test_report_file_id
     FROM version_transfer_requests r JOIN batch_items bi ON bi.transfer_request_id = r.id
     JOIN integration_batches b ON b.id = bi.batch_id WHERE r.package_version_id = ? AND r.project_id = 1`,
  );
  const original = requestEvidence.get(sample.versionId);
  expect(original).toMatchObject({ status: "PASSED", conclusion: "PASS", test_report_file_id: expect.any(Number) });

  await login(page, "ADMIN001");
  await expectTrialState(page, sample, "待发试制");
  await page.goto(`/settings/packages/${sample.packageId}`);
  const usageForm = page.getByTestId("package-usage-form");
  const newProject = usageForm.locator("details").filter({ hasText: "极光 M2" });
  await newProject.locator("summary").click();
  await newProject.getByRole("checkbox", { name: /^EVT/ }).check();
  await newProject.getByRole("checkbox", { name: /^DVT/ }).check();
  const addedRequests = trialData.db.prepare(
    "SELECT id, status FROM version_transfer_requests WHERE package_version_id = ? AND project_id = 2",
  );
  await usageForm.getByRole("button", { name: "保存使用范围" }).click();
  await expectFlash(page, "项目使用范围已更新");
  const added = addedRequests.all(sample.versionId);
  expect(added).toEqual([{ id: expect.any(Number), status: "PENDING" }]);
  await page.goto(`/settings/packages/${sample.packageId}`);
  await usageForm.getByRole("button", { name: "保存使用范围" }).click();
  await expectFlash(page, "项目使用范围已更新");
  expect(addedRequests.all(sample.versionId)).toEqual(added);
  expect(requestEvidence.get(sample.versionId)).toEqual(original);
  await expectTrialState(page, sample, "待其他项目验收");

  await login(page, "MGR002");
  await page.goto("/submissions?project=2");
  const pendingRow = page.getByRole("row").filter({ hasText: sample.code }).filter({ hasText: sample.version });
  await expect(pendingRow).toHaveCount(1);
  await page.getByTestId("open-batch-2").click();
  const builder = page.getByTestId("batch-builder-form");
  const includedLabel = `本轮转测 ${sample.name}`;
  await expect(builder.getByRole("checkbox", { name: includedLabel, exact: true })).toBeChecked();
  for (const checkbox of await builder.getByRole("checkbox").all()) {
    if (await checkbox.getAttribute("aria-label") !== includedLabel) await checkbox.uncheck();
  }
  await expect(builder.getByRole("checkbox", { checked: true })).toHaveCount(1);
  await builder.getByLabel("批次号", { exact: true }).fill("B9331");
  await builder.getByRole("button", { name: "保存草稿并核对" }).click();
  await expectFlash(page, "转测草稿已保存");
  const batchId = Number(new URL(page.url()).pathname.split("/").at(-1));
  await page.getByRole("button", { name: "发起转测", exact: true }).click();
  await confirmAction(page);
  await expectFlash(page, "B9331 已发起集成测试");

  await submitPassingConclusion(page, batchId, "TEST002");
  await login(page, "MGR001");
  await expectTrialState(page, sample, "待发试制");
  expect(requestEvidence.get(sample.versionId)).toEqual(original);
});

test("恢复项目补齐转测申请，再次归档后恢复原试制资格", async ({ page, trialData }) => {
  const sample = trialData.create(34, [1]);
  const projectId = trialData.addArchivedProject(sample.packageId);
  const requests = trialData.db.prepare(
    "SELECT id, status FROM version_transfer_requests WHERE package_version_id = ? AND project_id = ?",
  );
  await submitPassingConclusion(page, sample.batches[0], "TEST001");
  await login(page, "ADMIN001");
  await expectTrialState(page, sample, "待发试制");
  expect(requests.all(sample.versionId, projectId)).toEqual([]);

  await setProjectArchiveState(page, projectId, "ACTIVE");
  const restored = requests.all(sample.versionId, projectId);
  expect(restored).toEqual([{ id: expect.any(Number), status: "PENDING" }]);
  await expectTrialState(page, sample, "待其他项目验收");
  const traceUrl = `/versions?q=${sample.version}&f_status=PENDING_TRIAL`;
  const traceRow = page.getByRole("region", { name: "版本记录表格" }).getByRole("row").filter({ hasText: sample.version });
  await page.goto(traceUrl);
  await expect(traceRow).toHaveCount(0);

  await setProjectArchiveState(page, projectId, "ARCHIVED");
  expect(requests.all(sample.versionId, projectId)).toEqual(restored);
  await expectTrialState(page, sample, "待发试制");
  await page.goto(traceUrl);
  await expect(traceRow).toContainText("待发试制");
});
