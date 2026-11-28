import type { DatabaseSync } from "node:sqlite";
import { transaction } from "../../lib/db";
import { withImmediateTransaction } from "../../lib/sqlite-lifecycle";

declare const database: DatabaseSync;

transaction(() => ({ id: 1, then: "ordinary data" })) satisfies { id: number; then: string };
withImmediateTransaction(database, () => Math.random() > 0.5 ? 1 as const : null) satisfies 1 | null;
withImmediateTransaction(database, () => {}) satisfies void;

// @ts-expect-error SQLite callbacks must complete their work synchronously.
withImmediateTransaction(database, async () => 1);
// @ts-expect-error A callback returning a Promise is asynchronous even without the async keyword.
transaction(() => Promise.resolve(1));
// @ts-expect-error Every branch of a transaction callback must complete synchronously.
transaction(() => Math.random() > 0.5 ? 1 : Promise.resolve(1));
// @ts-expect-error A callable then method can defer completion without a native Promise.
withImmediateTransaction(database, () => ({ then: (resolve: (result: number) => void) => resolve(1) }));
