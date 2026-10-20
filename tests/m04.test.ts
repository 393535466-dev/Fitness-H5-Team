import { describe, it, expect, vi } from "vitest";
import { createPreviewApi } from "../src/features/training/preview";
import {
  TrainingService,
  type TrainingDependencies,
} from "../server/src/modules/training/service";
import {
  transition,
  sessionDto,
  reminderInput,
  nextTrigger,
  TrainingError,
  businessDate,
} from "../server/src/modules/training/domain";
import {
  SqlTrainingRepository,
  type TrainingRepository,
} from "../server/src/modules/training/repository";
import {
  trainingRoutes,
  trainingHandler,
} from "../server/src/modules/training/http";
import { createTrainingApi } from "../src/features/training/api";
import type {
  SessionRow,
  CourseRow,
  ReminderRow,
  SqlTx,
  CommandContext,
  PointAwardDto,
  TemplateDto,
  PlanDto,
} from "../server/src/modules/training/types";
const user = "a0000000-0000-4000-8000-000000000001",
  other = "a0000000-0000-4000-8000-000000000002",
  course = "c0000000-0000-4000-8000-000000000001",
  template = "c0000000-0000-4000-8000-000000000002";
const t0 = "2026-10-20T10:00:00.000Z",
  at = (s: number) => new Date(Date.parse(t0) + s * 1000).toISOString();
const context = (s = 0, who = user): CommandContext => ({
  userId: who,
  operationNow: at(s),
  businessDate: businessDate(at(s)),
  requestId: "b0000000-0000-4000-8000-000000000001",
  platform: "h5",
});
const tx: SqlTx = {
  query: async () => [],
  execute: async () => ({ affectedRows: 1 }),
};
const c: CourseRow = {
  id: course,
  title: "舒展",
  description: "全身舒展",
  category: "stretch",
  level: "beginner",
  cover_asset_id: null,
  video_asset_id: null,
  status: "published",
  estimated_duration_seconds: 600,
  estimated_calories_kcal: "60.0",
  version: 1,
  created_at: t0,
};
const input = {
  enabled: true,
  localTime: "19:00",
  timezone: "Asia/Shanghai",
  weekdays: [1, 2, 3, 4, 5, 6, 7],
  channels: ["in_app"],
  skipIfCompleted: true,
  version: 0,
};
function harness() {
  let sessions: SessionRow[] = [],
    reminders: ReminderRow[] = [],
    awards: PointAwardDto[] = [],
    events: unknown[] = [],
    plans: PlanDto[] = [];
  const fixture: TemplateDto = {
    id: template,
    title: "一周",
    description: "四练三休",
    days: Array.from({ length: 7 }, (_, i) => ({
      dayOffset: i,
      restDay: i % 2 === 1,
      courseIds: i % 2 === 1 ? [] : [course],
    })),
  };
  const repository = {
    course: async () => structuredClone(c),
    template: async () => structuredClone(fixture),
    current: async (_tx: SqlTx, u: string) =>
      structuredClone(
        sessions.find(
          (r) => r.user_id === u && ["active", "paused"].includes(r.status),
        ) ?? null,
      ),
    session: async (_tx: SqlTx, u: string, id: string) =>
      structuredClone(
        sessions.find((r) => r.user_id === u && r.id === id) ?? null,
      ),
    insertSession: async (_tx: SqlTx, r: SessionRow) => {
      sessions.push(structuredClone(r));
    },
    updateSession: async (_tx: SqlTx, r: SessionRow, v: number) => {
      const i = sessions.findIndex((x) => x.id === r.id);
      if (sessions[i].version !== v)
        throw new TrainingError(409, "VERSION_CONFLICT", "冲突");
      sessions[i] = structuredClone(r);
    },
    reminder: async (_tx: SqlTx, u: string) =>
      structuredClone(reminders.find((r) => r.user_id === u) ?? null),
    saveReminder: async (_tx: SqlTx, r: ReminderRow) => {
      reminders = reminders
        .filter((x) => x.user_id !== r.user_id)
        .concat(structuredClone(r));
    },
    hasEffectiveWorkout: async (_tx: SqlTx, u: string, d: string) =>
      sessions.some(
        (s) =>
          s.user_id === u &&
          s.business_date === d &&
          s.status === "completed" &&
          s.reward_eligible === 1,
      ),
    replacePlan: async (
      _tx: SqlTx,
      u: string,
      t: TemplateDto,
      start: string,
    ) => {
      plans.forEach((p) => (p.status = "archived"));
      const p: PlanDto = {
        id: "d0000000-0000-4000-8000-000000000001",
        title: t.title,
        templateId: t.id,
        startDate: start,
        endDate: start,
        status: "active",
        items: t.days.map((d, i) => ({
          id: String(i),
          scheduledDate: start,
          courseId: d.courseIds[0] ?? null,
          restDay: d.restDay,
          sortOrder: 0,
        })),
      };
      plans.push(structuredClone(p));
      return p;
    },
  } as unknown as TrainingRepository;
  const points = vi.fn(
    async (
      passed: SqlTx,
      ctx: CommandContext,
      i:
        | { type: "checkin" }
        | {
            type: "water_recorded" | "meal_confirmed" | "workout_completed";
            sourceId: string;
          },
    ) => {
      expect(passed).toBe(tx);
      const s = sessions.find(
        (s) => s.id === ("sourceId" in i ? i.sourceId : undefined),
      )!;
      expect(s.status).toBe("completed");
      if (
        !awards.some(
          (a) =>
            a.businessDate === s.business_date && a.scopeKey === s.course_id,
        )
      )
        awards.push({
          id: "e0000000-0000-4000-8000-000000000001",
          taskCode: "course_workout",
          points: 20,
          businessDate: s.business_date!,
          scopeKey: s.course_id,
        });
      return {
        awards: structuredClone(awards),
        account: {
          balance: 20,
          lifetimeEarned: 20,
          lifetimeSpent: 0,
          version: 1,
        },
      };
    },
  );
  const deps: TrainingDependencies = {
    repository,
    points: {
      awardInTransaction: points,
      ensureAccountInTransaction: async () => ({
        balance: 0,
        lifetimeEarned: 0,
        lifetimeSpent: 0,
        version: 1,
      }),
    },
    outbox: {
      enqueueInTransaction: async (p, e) => {
        expect(p).toBe(tx);
        events.push(e);
        return { id: course };
      },
    },
    media: {
      assertReady: async () => {
        throw Error("not configured");
      },
      createReadUrl: async () => {
        throw Error("not configured");
      },
    },
    audit: { recordInTransaction: async () => {} },
    awardsQuery: { forWorkout: async () => structuredClone(awards) },
    capability: { inApp: true, webPush: false, appPush: false },
    rewardThresholdRatio: 0.8,
  };
  const service = new TrainingService(deps);
  // Test double of M01 user-lock/UoW. It is NOT a MySQL acceptance substitute.
  let tail = Promise.resolve();
  function run<T>(ctx: CommandContext, fn: () => Promise<T>): Promise<T> {
    const task = tail.then(async () => {
      const before = structuredClone({
        sessions,
        reminders,
        awards,
        events,
        plans,
      });
      try {
        return await fn();
      } catch (e) {
        ({ sessions, reminders, awards, events, plans } = before);
        throw e;
      }
    });
    tail = task.then(
      () => {},
      () => {},
    );
    return task;
  }
  return {
    service,
    points,
    fixture,
    run,
    get sessions() {
      return sessions;
    },
    get reminders() {
      return reminders;
    },
    get awards() {
      return awards;
    },
    get events() {
      return events;
    },
    get plans() {
      return plans;
    },
  };
}
async function start(h: ReturnType<typeof harness>) {
  return h.run(context(), () =>
    h.service.start(tx, context(), { courseId: course }),
  );
}
describe("M04 server settlement and atomic command contract (in-memory UoW test double)", () => {
  it("200 activity + 300 pause + 280 activity = 480, DTO extrapolation does not persist", async () => {
    const h = harness(),
      s = await start(h);
    await h.service.update(tx, context(200), s.id, {
      action: "pause",
      version: 1,
    });
    expect(h.sessions[0].active_duration_seconds).toBe(200);
    expect(
      (await h.service.current(tx, context(500))).session
        ?.activeDurationSeconds,
    ).toBe(200);
    await h.service.update(tx, context(500), s.id, {
      action: "resume",
      version: 2,
    });
    expect(
      (await h.service.current(tx, context(780))).session
        ?.activeDurationSeconds,
    ).toBe(480);
    expect(h.sessions[0].active_duration_seconds).toBe(200);
    const r = await h.service.complete(tx, context(780), s.id, { version: 3 });
    expect(r.session).toMatchObject({
      activeDurationSeconds: 480,
      rewardEligible: true,
      estimatedCaloriesKcal: 48,
      version: 4,
    });
    expect(h.points).toHaveBeenCalledTimes(1);
  });
  it.each([
    [479, false, 47.9],
    [480, true, 48],
    [900, true, 60],
  ])(
    "%i seconds is stored; eligibility %s; capped kcal %s",
    async (n, eligible, kcal) => {
      const h = harness(),
        s = await start(h);
      const r = await h.service.complete(tx, context(n), s.id, { version: 1 });
      expect(r.session).toMatchObject({
        status: "completed",
        activeDurationSeconds: n,
        rewardEligible: eligible,
        estimatedCaloriesKcal: kcal,
      });
      expect(h.points).toHaveBeenCalledTimes(eligible ? 1 : 0);
    },
  );
  it("floors each activity segment, never paused wall time", async () => {
    const h = harness(),
      s = await start(h);
    await h.service.update(tx, context(1.9), s.id, {
      action: "pause",
      version: 1,
    });
    await h.service.update(tx, context(5), s.id, {
      action: "resume",
      version: 2,
    });
    const r = await h.service.complete(tx, context(6.9), s.id, { version: 3 });
    expect(r.session.activeDurationSeconds).toBe(2);
  });
  it("Shanghai completion day crosses midnight", async () => {
    const h = harness(),
      ctx = { ...context(), operationNow: "2026-10-20T15:59:50.000Z" };
    const s = await h.service.start(tx, ctx, { courseId: course });
    const r = await h.service.complete(
      tx,
      { ...ctx, operationNow: "2026-10-20T16:01:00.000Z" },
      s.id,
      { version: 1 },
    );
    expect(r.session.businessDate).toBe("2026-10-21");
    expect(r.session.activeDurationSeconds).toBe(70);
  });
  it("snapshots survive course/config changes", async () => {
    const h = harness(),
      s = await start(h);
    h.service.deps.rewardThresholdRatio = 0.5;
    const old = c.estimated_calories_kcal;
    c.estimated_calories_kcal = 900;
    try {
      const r = await h.service.complete(tx, context(479), s.id, {
        version: 1,
      });
      expect(r.session).toMatchObject({
        durationSnapshotSeconds: 600,
        rewardThresholdSeconds: 480,
        rewardEligible: false,
        estimatedCaloriesKcal: 47.9,
      });
    } finally {
      c.estimated_calories_kcal = old;
    }
  });
  it("points failure rolls back terminal state and timing; retry settles once", async () => {
    const h = harness(),
      s = await start(h);
    h.points.mockRejectedValueOnce(Error("M05 offline"));
    await expect(
      h.run(context(480), () =>
        h.service.complete(tx, context(480), s.id, { version: 1 }),
      ),
    ).rejects.toThrow("M05 offline");
    expect(h.sessions[0]).toMatchObject({
      status: "active",
      version: 1,
      accumulated_seconds: 0,
    });
    expect(h.awards).toEqual([]);
    const r = await h.run(context(480), () =>
      h.service.complete(tx, context(480), s.id, { version: 1 }),
    );
    expect(r.session.activeDurationSeconds).toBe(480);
    expect(h.awards).toHaveLength(1);
  });
  it("completed retry returns original awards without awarding again", async () => {
    const h = harness(),
      s = await start(h);
    const r = await h.service.complete(tx, context(480), s.id, { version: 1 });
    expect(
      await h.service.complete(tx, context(900), s.id, { version: 1 }),
    ).toEqual(r);
    expect(h.points).toHaveBeenCalledTimes(1);
    await expect(
      h.service.update(tx, context(901), s.id, {
        action: "resume",
        version: 1,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("two serialized starts retain one open session and conflict includes existing ID", async () => {
    const h = harness();
    const result = await Promise.allSettled([start(h), start(h)]);
    expect(result.map((r) => r.status)).toEqual(["fulfilled", "rejected"]);
    expect(h.sessions).toHaveLength(1);
    expect((result[1] as PromiseRejectedResult).reason).toMatchObject({
      code: "WORKOUT_IN_PROGRESS",
      details: { sessionId: h.sessions[0].id },
    });
  });
  it("pause vs complete on old version: only first succeeds; other owner cannot mutate", async () => {
    const h = harness(),
      s = await start(h);
    const result = await Promise.allSettled([
      h.run(context(200), () =>
        h.service.update(tx, context(200), s.id, {
          action: "pause",
          version: 1,
        }),
      ),
      h.run(context(200), () =>
        h.service.complete(tx, context(200), s.id, { version: 1 }),
      ),
    ]);
    expect(result.map((r) => r.status)).toEqual(["fulfilled", "rejected"]);
    expect(h.sessions[0].status).toBe("paused");
    await expect(
      h.service.update(tx, context(300, other), s.id, {
        action: "abandon",
        version: 2,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("abandon is irreversible and has no calories/awards", async () => {
    const h = harness(),
      s = await start(h);
    const r = await h.service.update(tx, context(900), s.id, {
      action: "abandon",
      version: 1,
    });
    expect(r).toMatchObject({
      status: "abandoned",
      estimatedCaloriesKcal: 0,
      rewardEligible: false,
    });
    await expect(
      h.service.complete(tx, context(901), s.id, { version: 2 }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("clock rollback while active or paused fails instead of reducing totals", async () => {
    const h = harness(),
      s = await start(h);
    await expect(
      h.service.update(tx, context(-1), s.id, { action: "pause", version: 1 }),
    ).rejects.toMatchObject({ code: "CLOCK_MOVED_BACKWARDS" });
    await h.service.update(tx, context(200), s.id, {
      action: "pause",
      version: 1,
    });
    await expect(
      h.service.update(tx, context(199), s.id, {
        action: "resume",
        version: 2,
      }),
    ).rejects.toMatchObject({ code: "CLOCK_MOVED_BACKWARDS" });
  });
  it("rejects unknown body fields and invalid IDs", async () => {
    const h = harness();
    await expect(
      h.service.start(tx, context(), { courseId: course, userId: other }),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      h.service.start(tx, context(), { courseId: "COURSE" }),
    ).rejects.toMatchObject({ status: 422 });
  });
});
describe("M04 reminders, plan copies and adapters", () => {
  it("unconfigured reminder is null; first CAS 0 -> 1, old update rejected", async () => {
    const h = harness();
    expect(await h.service.reminder(tx, context())).toBeNull();
    const r = await h.service.saveReminder(tx, context(), input);
    expect(r.version).toBe(1);
    expect(r.nextTriggerAt).toBe("2026-10-20T11:00:00.000Z");
    await expect(
      h.service.saveReminder(tx, context(), input),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("parallel first saves serialize through user lock", async () => {
    const h = harness();
    const r = await Promise.allSettled([
      h.run(context(), () => h.service.saveReminder(tx, context(), input)),
      h.run(context(), () => h.service.saveReminder(tx, context(), input)),
    ]);
    expect(r.map((x) => x.status)).toEqual(["fulfilled", "rejected"]);
    expect(h.reminders).toHaveLength(1);
  });
  it("rejects malformed reminder arrays, time, unknown fields and unavailable channels", () => {
    const cap = { inApp: true, webPush: false, appPush: false };
    for (const patch of [
      { weekdays: [1, 1] },
      { weekdays: [0] },
      { weekdays: [] },
      { channels: ["in_app", "in_app"] },
      { channels: ["web_push"] },
      { localTime: "24:00" },
      { localTime: "9:00" },
      { timezone: "UTC" },
      { version: -1 },
      { userId: user },
    ])
      expect(() => reminderInput({ ...input, ...patch }, cap)).toThrow(
        TrainingError,
      );
  });
  it("next trigger uses Shanghai weekday and strictly future time", () => {
    expect(nextTrigger("19:00", [2], "2026-10-20T11:00:00.000Z")).toBe(
      "2026-10-27T11:00:00.000Z",
    );
    expect(nextTrigger("00:00", [3], "2026-10-20T15:59:59.999Z")).toBe(
      "2026-10-20T16:00:00.000Z",
    );
  });
  it("worker advances and enqueues once; redelivery of same schedule is stale", async () => {
    const h = harness(),
      r = await h.service.saveReminder(tx, context(), input),
      expected = {
        reminderId: r.id,
        reminderVersion: 1,
        scheduledAt: r.nextTriggerAt!,
      };
    expect(await h.service.processDue(tx, context(3600), expected)).toEqual({
      processed: true,
      notified: true,
    });
    expect(h.events).toHaveLength(1);
    expect(await h.service.processDue(tx, context(3601), expected)).toEqual({
      processed: false,
      notified: false,
    });
    expect(h.events).toHaveLength(1);
    expect(h.reminders[0].version).toBe(1);
  });
  it.each([479, 480])(
    "skipIfCompleted only skips eligible training (%i seconds)",
    async (duration) => {
      const h = harness(),
        s = await start(h);
      await h.service.complete(tx, context(duration), s.id, { version: 1 });
      const r = await h.service.saveReminder(tx, context(), input);
      const outcome = await h.service.processDue(tx, context(3600), {
        reminderId: r.id,
        reminderVersion: 1,
        scheduledAt: r.nextTriggerAt!,
      });
      expect(outcome.notified).toBe(duration < 480);
    },
  );
  it("disabled/revised old schedules and notification consumers are rejected", async () => {
    const h = harness(),
      r = await h.service.saveReminder(tx, context(), input),
      expected = {
        reminderId: r.id,
        reminderVersion: 1,
        scheduledAt: r.nextTriggerAt!,
      };
    await h.service.saveReminder(tx, context(), {
      ...input,
      enabled: false,
      version: 1,
    });
    expect(h.reminders[0].next_trigger_at).toBeNull();
    expect(
      await h.service.processDue(tx, context(3600), expected),
    ).toMatchObject({ processed: false });
    expect(
      await h.service.validateNotification(tx, { ...expected, userId: user }),
    ).toBeNull();
  });
  it("outbox failure must roll back schedule advancement", async () => {
    const h = harness(),
      r = await h.service.saveReminder(tx, context(), input);
    h.service.deps.outbox.enqueueInTransaction = async () => {
      throw Error("outbox failed");
    };
    await expect(
      h.run(context(3600), () =>
        h.service.processDue(tx, context(3600), {
          reminderId: r.id,
          reminderVersion: 1,
          scheduledAt: r.nextTriggerAt!,
        }),
      ),
    ).rejects.toThrow();
    expect(h.reminders[0].next_trigger_at).toBe(r.nextTriggerAt);
  });
  it("templates must contain explicit rest days; plans copy values", async () => {
    const h = harness();
    await h.service.createPlan(tx, context(), {
      templateId: template,
      startDate: "2026-10-19",
    });
    h.fixture.title = "changed";
    h.fixture.days[0].courseIds = [];
    expect(h.plans[0].title).toBe("一周");
    expect(h.plans[0].items.filter((x) => x.restDay)).toHaveLength(3);
    await expect(
      h.service.createPlan(tx, context(), {
        templateId: template,
        startDate: "2026-10-19",
      }),
    ).rejects.toMatchObject({ code: "INVALID_TEMPLATE" });
    await expect(
      h.service.plan(tx, context(), "2026-10-20"),
    ).rejects.toMatchObject({ status: 422 });
  });
  it("parameterized catalog escapes wildcard and binds course values", async () => {
    const calls: { sql: string; args: unknown }[] = [];
    const db: SqlTx = {
      query: async (sql, args) => {
        calls.push({ sql, args });
        return [];
      },
      execute: async () => ({ affectedRows: 1 }),
    };
    await new SqlTrainingRepository().courses(db, {
      keyword: "%' OR 1=1 --",
      category: "stretch",
    });
    expect(calls[0].sql).not.toContain("OR 1=1");
    expect(calls[0].args).toEqual(["stretch", "%=%' OR 1==1 --%", 21]);
  });
  it("publishes exactly 15 routes and enforces strict query parsing", async () => {
    const h = harness(),
      routes = trainingRoutes(h.service);
    expect(routes).toHaveLength(15);
    expect(new Set(routes.map((r) => r.method + r.path)).size).toBe(15);
    expect(routes.filter((r) => r.access === "admin")).toHaveLength(3);
    const r = routes.find((r) => r.path === "training/courses")!;
    for (const q of [
      { category: "run" },
      { limit: "1x" },
      { userId: user },
      { level: ["beginner", "intermediate"] },
    ])
      await expect(
        Promise.resolve().then(() =>
          r.run(tx, context(), { headers: {}, query: q }),
        ),
      ).rejects.toMatchObject({ status: 422 });
  });
  it("public media URLs are signed AFTER executor transaction ends", async () => {
    const h = harness();
    let ended = false;
    h.service.repo.course = async () => ({ ...c, cover_asset_id: course });
    h.service.deps.media.createReadUrl = async () => {
      expect(ended).toBe(true);
      return {
        assetId: course,
        readUrl: "https://assets.example.test/safe",
        readUrlExpiresAt: at(300),
      };
    };
    const route = trainingRoutes(h.service).find(
      (r) => r.path === "training/courses/:id",
    )!;
    const handle = trainingHandler(
      h.service,
      {
        execute: async (_r, _p, fn) => {
          const data = await fn(tx, context());
          ended = true;
          return { status: 200, body: { data, meta: {} } };
        },
      },
      route,
    );
    const response = await handle({ headers: {}, params: { id: course } });
    expect(
      (response.body as { data: { coverUrl: string } }).data.coverUrl,
    ).toBe("https://assets.example.test/safe");
  });
  it("front-end delegates requests and retries to ONE shared transport, exact same supplied key", async () => {
    const request = vi.fn(async () => ({
        data: {},
        meta: {
          requestId: course,
          serverTime: t0,
          timezone: "Asia/Shanghai" as const,
        },
      })),
      invalidateHealth = vi.fn();
    const api = createTrainingApi({
      request: request as never,
      invalidateHealth,
    });
    await api.start(course, "retry-key");
    await api.start(course, "retry-key");
    expect(request.mock.calls[0]).toEqual(request.mock.calls[1]);
    await api.saveReminder(input as never);
    expect((request.mock.calls as unknown[][])[2][0]).toMatchObject({
      method: "PUT",
      path: "/api/v1/me/training-reminder",
    });
    await api.invalidateHealth("2026-10-20");
    expect(invalidateHealth).toHaveBeenCalledWith("2026-10-20");
  });
});

describe("M04 administrator material workflow", () => {
  const body = {
    title: "新课程",
    category: "stretch",
    level: "beginner",
    description: "舒展说明",
    estimatedDurationSeconds: 600,
    estimatedCaloriesKcal: 60,
    coverAssetId: course,
  };
  it("creation is draft and checks ready material/admin access before write and audit", async () => {
    const h = harness(),
      order: string[] = [];
    h.service.repo.saveCourse = async (passed, row, expected) => {
      expect(passed).toBe(tx);
      expect(expected).toBeNull();
      expect(row.status).toBe("draft");
      order.push("save");
    };
    h.service.deps.media.assertReady = async (passed, input) => {
      expect(passed).toBe(tx);
      expect(input).toMatchObject({
        assetId: course,
        purpose: "course_cover",
        access: "admin_material",
        actorUserId: user,
      });
      order.push("media");
      return {
        assetId: course,
        purpose: "course_cover",
        userId: null,
        contentType: "image/png",
        sizeBytes: 20,
      };
    };
    h.service.deps.audit.recordInTransaction = async (passed, ctx, input) => {
      expect(passed).toBe(tx);
      expect(ctx).toEqual(context());
      expect(input.action).toBe("training.course.create");
      order.push("audit");
    };
    const result = await h.service.adminCourse(tx, context(), null, body);
    expect(result).toMatchObject({
      status: "draft",
      version: 1,
      coverUrl: null,
    });
    expect(order).toEqual(["media", "save", "audit"]);
  });
  it("unready material fails without writing a course", async () => {
    const h = harness(),
      save = vi.fn();
    h.service.repo.saveCourse = save;
    await expect(
      h.service.adminCourse(tx, context(), null, body),
    ).rejects.toThrow("not configured");
    expect(save).not.toHaveBeenCalled();
  });
  it("edit is versioned and returns a draft; stale publish fails", async () => {
    const h = harness(),
      save = vi.fn();
    h.service.repo.saveCourse = save;
    const draft = await h.service.adminCourse(tx, context(), course, {
      title: "修改标题",
      version: 1,
    });
    expect(draft).toMatchObject({
      title: "修改标题",
      status: "draft",
      version: 2,
    });
    await expect(
      h.service.adminCourse(tx, context(), course, { version: 2 }, true),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    const published = await h.service.adminCourse(
      tx,
      context(),
      course,
      { version: 1 },
      true,
    );
    expect(published.status).toBe("published");
  });
  it("query port forwards the same transaction and maps DECIMAL without writing", async () => {
    const h = harness(),
      days = vi.fn(async () => []);
    h.service.repo.days = days;
    h.service.repo.recommended = async (passed) => {
      expect(passed).toBe(tx);
      return c;
    };
    const port = h.service.queryPort();
    await port.days(tx, user, "2026-10-19", "2026-10-25");
    expect(days).toHaveBeenCalledWith(tx, user, "2026-10-19", "2026-10-25");
    expect(await port.recommendedCourse(tx, user, "2026-10-20")).toMatchObject({
      estimatedCaloriesKcal: 60,
      estimatedDurationSeconds: 600,
    });
  });
});

it("fails closed for missing adapters and forbids preview fixtures in production", () => {
  const h = harness();
  expect(
    () =>
      new TrainingService({ ...h.service.deps, points: undefined as never }),
  ).toThrow("M04 integration missing: points");
  try {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => createPreviewApi()).toThrow(
      "must not be enabled in production",
    );
  } finally {
    vi.unstubAllEnvs();
  }
});
