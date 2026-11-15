import { db, all } from "../lib/db";

const users = all<{ count: number }>("SELECT COUNT(*) AS count FROM users")[0]?.count ?? 0;
const packages = all<{ count: number }>("SELECT COUNT(*) AS count FROM packages")[0]?.count ?? 0;
const batches = all<{ count: number }>("SELECT COUNT(*) AS count FROM integration_batches")[0]?.count ?? 0;
console.log(`数据库已就绪：${users} 位用户，${packages} 个软件包，${batches} 个转测批次。`);
console.log(db.prepare("PRAGMA database_list").all());
