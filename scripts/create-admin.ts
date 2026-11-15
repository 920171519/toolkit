import { hashPassword } from "../lib/password";
import { one, run } from "../lib/db";

const args = process.argv.slice(2);
if (args[0] === "--") args.shift();
const [name, employeeId, password] = args;

if (!name || !employeeId || !password) {
  console.error("用法：TOOLKIT_SKIP_SEED=1 pnpm admin:create -- <姓名> <工号> <密码>");
  process.exit(1);
}
if (name.trim().length < 2) {
  console.error("姓名至少需要 2 个字符。");
  process.exit(1);
}
if (!/^[A-Za-z0-9_-]{3,32}$/.test(employeeId)) {
  console.error("工号需为 3-32 位字母、数字、下划线或中划线。");
  process.exit(1);
}
if (password.length < 8) {
  console.error("密码至少需要 8 个字符。");
  process.exit(1);
}

const existing = one<{ id: number; name: string }>(
  "SELECT id, name FROM users WHERE employee_id = ? COLLATE NOCASE",
  employeeId,
);

if (existing) {
  run(
    "UPDATE users SET role = 'ADMIN', is_active = 1, name = ?, title = '系统管理员' WHERE id = ?",
    name.trim(),
    existing.id,
  );
  console.log(`已将现有账号 ${employeeId}（${existing.name}）提升为系统管理员，密码保持不变。`);
} else {
  const result = run(
    `INSERT INTO users (name, employee_id, password_hash, role, department, title, is_active, created_at)
     VALUES (?, ?, ?, 'ADMIN', ?, '系统管理员', 1, ?)`,
    name.trim(),
    employeeId.trim().toUpperCase(),
    hashPassword(password),
    process.env.NEXT_PUBLIC_DEPARTMENT_NAME || "软件工程部",
    new Date().toISOString(),
  );
  console.log(`已创建系统管理员 ${name.trim()}（${employeeId}），用户 ID：${result.lastInsertRowid}。`);
}
console.log("现在可以使用该工号登录系统，并在“人员与角色”中配置其他成员。");
