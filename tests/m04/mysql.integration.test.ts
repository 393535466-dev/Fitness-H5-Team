/** Optional REAL MySQL 8.4 suite. Never replaces unavailable MySQL with SQLite.
 * Requires an explicitly disposable qingyang_m04_test database initialized by M01
 * with V001, M01 test user A, and db/seeds/M04/001_courses_and_template.sql.
 * Points/Outbox here are test doubles; this does NOT certify M01/M05 integration. */
import { beforeAll, afterAll, afterEach, describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { TrainingService } from "../../server/src/modules/training/service";
import { SqlTrainingRepository } from "../../server/src/modules/training/repository";
import { businessDate } from "../../server/src/modules/training/domain";
import type {
  SqlTx,
  CommandContext,
  SessionRow,
} from "../../server/src/modules/training/types";
// Structural driver types avoid adding M01-owned dependencies or lockfiles.
interface Connection {
  query(sql: string, values?: readonly unknown[]): Promise<[unknown, unknown]>;
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  release(): void;
}
interface Pool {
  getConnection(): Promise<Connection>;
  end(): Promise<void>;
}
const url = process.env.M04_MYSQL_TEST_URL;
const user = "a0000000-0000-4000-8000-000000000001",
  course = "c0000000-0000-4000-8000-000000000001",
  template = "c0000000-0000-4000-8000-000000000002";
const t0 = "2026-10-20T10:00:00.000Z",
  now = (seconds = 0) =>
    new Date(Date.parse(t0) + seconds * 1000).toISOString();
let pool: Pool;
function adapt(conn: Connection): SqlTx {
  return {
    query: async <T extends object>(
      sql: string,
      values: Parameters<SqlTx["query"]>[1],
    ) => (await conn.query(sql, values))[0] as T[],
    execute: async (sql, values) =>
      (await conn.query(sql, values))[0] as { affectedRows: number },
  };
}
async function run<T>(
  seconds: number,
  fn: (tx: SqlTx, ctx: CommandContext) => Promise<T>,
) {
  const conn = await pool.getConnection();
  try {
    await conn.query("SET time_zone='+00:00'");
    await conn.beginTransaction();
    const tx = adapt(conn);
    await tx.query("SELECT id FROM users WHERE id=? FOR UPDATE", [user]);
    const r = await fn(tx, {
      userId: user,
      operationNow: now(seconds),
      businessDate: businessDate(now(seconds)),
      requestId: randomUUID(),
      platform: "h5",
    });
    await conn.commit();
    return r;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}
const service = new TrainingService({
  repository: new SqlTrainingRepository(),
  rewardThresholdRatio: 0.8,
  capability: { inApp: true, webPush: false, appPush: false },
  points: {
    ensureAccountInTransaction: async () => {
      throw Error("M05 not bound");
    },
    awardInTransaction: async () => {
      throw Error("injected M05 failure");
    },
  },
  outbox: { enqueueInTransaction: async () => ({ id: randomUUID() }) },
  media: {
    assertReady: async () => {
      throw Error("no media");
    },
    createReadUrl: async () => {
      throw Error("no media");
    },
  },
  audit: { recordInTransaction: async () => {} },
  awardsQuery: { forWorkout: async () => [] },
});
let ready = false;
describe.skipIf(!url)(
  "M04 SQL acceptance on REAL MySQL 8.4 (M01/M05 doubles)",
  () => {
    beforeAll(async () => {
      const address = new URL(url!);
      if (address.pathname !== "/qingyang_m04_test")
        throw Error(
          "Use ONLY the explicitly disposable qingyang_m04_test database",
        );
      const require = createRequire(
        new URL("../../server/package.json", import.meta.url),
      );
      const mysql = require("mysql2/promise") as {
        createPool(options: unknown): Pool;
      };
      pool = mysql.createPool({
        host: address.hostname,
        port: Number(address.port || 3306),
        user: decodeURIComponent(address.username),
        password: decodeURIComponent(address.password),
        database: "qingyang_m04_test",
        dateStrings: true,
        timezone: "Z",
        connectionLimit: 4,
      });
      const conn = await pool.getConnection();
      try {
        const tx = adapt(conn);
        const rows = await tx.query<{ version: string }>(
          "SELECT VERSION() AS version",
          [],
        );
        expect(rows[0].version).toMatch(/^8\.4\./);
        expect(
          await tx.query("SELECT id FROM users WHERE id=?", [user]),
        ).toHaveLength(1);
        expect(
          await tx.query(
            "SELECT id FROM training_courses WHERE id=? AND status='published' AND estimated_duration_seconds=600",
            [course],
          ),
        ).toHaveLength(1);
        for (const table of [
          "workout_sessions",
          "training_plans",
          "training_reminders",
        ])
          expect(
            await tx.query(`SELECT id FROM ${table} WHERE user_id=?`, [user]),
          ).toHaveLength(0);
        ready = true;
      } finally {
        conn.release();
      }
    });
    afterEach(async () => {
      if (!ready) return;
      await run(0, async (tx) => {
        await tx.execute(
          "DELETE FROM training_plan_items WHERE plan_id IN (SELECT id FROM training_plans WHERE user_id=?)",
          [user],
        );
        for (const table of [
          "training_plans",
          "workout_sessions",
          "training_reminders",
        ])
          await tx.execute(`DELETE FROM ${table} WHERE user_id=?`, [user]);
      });
    });
    afterAll(async () => {
      if (pool) await pool.end();
    });
    it("two real concurrent starts serialize on users; generated unique guard is a second protection", async () => {
      const starts = await Promise.allSettled([
        run(0, (tx, ctx) => service.start(tx, ctx, { courseId: course })),
        run(0, (tx, ctx) => service.start(tx, ctx, { courseId: course })),
      ]);
      expect(starts.filter((x) => x.status === "fulfilled")).toHaveLength(1);
      expect(starts.filter((x) => x.status === "rejected")).toHaveLength(1);
      await expect(
        run(0, async (tx) => {
          const row = (
            await tx.query<SessionRow>(
              "SELECT * FROM workout_sessions WHERE user_id=?",
              [user],
            )
          )[0];
          await service.repo.insertSession(tx, { ...row, id: randomUUID() });
        }),
      ).rejects.toMatchObject({ code: "ER_DUP_ENTRY" });
    });
    it("pause/resume settles 479 seconds with DECIMAL number mapping; current extrapolation never writes", async () => {
      const s = await run(0, (tx, ctx) =>
        service.start(tx, ctx, { courseId: course }),
      );
      await run(200, (tx, ctx) =>
        service.update(tx, ctx, s.id, { action: "pause", version: 1 }),
      );
      await run(500, (tx, ctx) =>
        service.update(tx, ctx, s.id, { action: "resume", version: 2 }),
      );
      await run(779, async (tx, ctx) => {
        expect(
          (await service.current(tx, ctx)).session?.activeDurationSeconds,
        ).toBe(479);
        expect(
          (
            await tx.query<SessionRow>(
              "SELECT * FROM workout_sessions WHERE id=?",
              [s.id],
            )
          )[0].active_duration_seconds,
        ).toBe(200);
      });
      const r = await run(779, (tx, ctx) =>
        service.complete(tx, ctx, s.id, { version: 3 }),
      );
      expect(r.session).toMatchObject({
        activeDurationSeconds: 479,
        estimatedCaloriesKcal: 47.9,
        rewardEligible: false,
        status: "completed",
      });
    });
    it("M05 failure rolls back actual UPDATE and leaves original active snapshot", async () => {
      const s = await run(0, (tx, ctx) =>
        service.start(tx, ctx, { courseId: course }),
      );
      await expect(
        run(480, (tx, ctx) => service.complete(tx, ctx, s.id, { version: 1 })),
      ).rejects.toThrow("injected M05 failure");
      await run(480, async (tx, ctx) => {
        expect(await service.current(tx, ctx)).toMatchObject({
          session: { id: s.id, status: "active", version: 1 },
        });
        expect(
          (
            await tx.query<SessionRow>(
              "SELECT * FROM workout_sessions WHERE id=?",
              [s.id],
            )
          )[0],
        ).toMatchObject({
          accumulated_seconds: 0,
          active_duration_seconds: 0,
          status: "active",
        });
      });
    });
    it("two plan replacements leave ONE complete active plan and archived copy", async () => {
      await Promise.all([
        run(0, (tx, ctx) =>
          service.createPlan(tx, ctx, {
            templateId: template,
            startDate: "2026-10-19",
          }),
        ),
        run(0, (tx, ctx) =>
          service.createPlan(tx, ctx, {
            templateId: template,
            startDate: "2026-10-19",
          }),
        ),
      ]);
      await run(0, async (tx) => {
        const plans = await tx.query<{ id: string; status: string }>(
          "SELECT id,status FROM training_plans WHERE user_id=?",
          [user],
        );
        expect(plans.filter((x) => x.status === "active")).toHaveLength(1);
        expect(plans.filter((x) => x.status === "archived")).toHaveLength(1);
        for (const plan of plans) {
          const items = await tx.query<{ rest_day: number }>(
            "SELECT rest_day FROM training_plan_items WHERE plan_id=?",
            [plan.id],
          );
          expect(items).toHaveLength(7);
          expect(items.filter((x) => x.rest_day === 1)).toHaveLength(3);
        }
      });
    });
    it("parallel first reminder writes use version=0, one succeeds and roundtrips JSON arrays", async () => {
      const input = {
        enabled: true,
        localTime: "19:00",
        timezone: "Asia/Shanghai",
        weekdays: [2],
        channels: ["in_app"],
        skipIfCompleted: true,
        version: 0,
      };
      const r = await Promise.allSettled([
        run(0, (tx, ctx) => service.saveReminder(tx, ctx, input)),
        run(0, (tx, ctx) => service.saveReminder(tx, ctx, input)),
      ]);
      expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
      await run(0, async (tx, ctx) =>
        expect(await service.reminder(tx, ctx)).toMatchObject({
          weekdays: [2],
          channels: ["in_app"],
          version: 1,
          nextTriggerAt: "2026-10-20T11:00:00.000Z",
        }),
      );
    });
  },
);
