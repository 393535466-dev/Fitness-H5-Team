import { randomUUID } from "node:crypto";
import type { TrainingRepository, ListQuery } from "./repository";
import type {
  SqlTx,
  CommandContext,
  PointsPort,
  OutboxPort,
  MediaPort,
  SessionRow,
  CourseRow,
  ReminderRow,
  TrainingReminderDto,
  TrainingAuditPort,
  WorkoutAwardsQueryPort,
  Capability,
  TrainingQueryPort,
} from "./types";
import {
  fail,
  object,
  uuid,
  integer,
  date,
  instant,
  businessDate,
  sessionDto,
  transition,
  courseDto,
  validateCourse,
  reminderInput,
  nextTrigger,
} from "./domain";
export interface TrainingDependencies {
  repository: TrainingRepository;
  points: PointsPort;
  outbox: OutboxPort;
  media: MediaPort;
  audit: TrainingAuditPort;
  awardsQuery: WorkoutAwardsQueryPort;
  capability: Capability;
  rewardThresholdRatio: number;
}
const jsonArray = <T>(v: T[] | string): T[] =>
  typeof v === "string" ? JSON.parse(v) : v;
export class TrainingService {
  constructor(readonly deps: TrainingDependencies) {
    const ports = {
      repository: deps.repository?.course,
      points: deps.points?.awardInTransaction,
      outbox: deps.outbox?.enqueueInTransaction,
      mediaReady: deps.media?.assertReady,
      mediaUrl: deps.media?.createReadUrl,
      audit: deps.audit?.recordInTransaction,
      originalAwards: deps.awardsQuery?.forWorkout,
    };
    for (const [name, method] of Object.entries(ports))
      if (typeof method !== "function")
        throw Error(`M04 integration missing: ${name}`);
    if (
      !deps.capability ||
      ["inApp", "webPush", "appPush"].some(
        (k) =>
          typeof (deps.capability as unknown as Record<string, unknown>)[k] !==
          "boolean",
      )
    )
      throw Error(
        "M04 notification capabilities must be explicitly configured",
      );
    if (
      !Number.isFinite(deps.rewardThresholdRatio) ||
      deps.rewardThresholdRatio <= 0 ||
      deps.rewardThresholdRatio > 1
    )
      throw Error("M04 requires the shared threshold configuration");
  }
  get repo() {
    return this.deps.repository;
  }
  async start(tx: SqlTx, ctx: CommandContext, body: unknown) {
    const o = object(body, ["courseId"]);
    const courseId = uuid(o.courseId);
    const current = await this.repo.current(tx, ctx.userId, true);
    if (current)
      fail(409, "WORKOUT_IN_PROGRESS", "已有未结束训练，请恢复或放弃", {
        sessionId: current.id,
      });
    const course = await this.repo.course(tx, courseId, true);
    if (!course || course.status !== "published")
      fail(404, "COURSE_NOT_FOUND", "课程不存在或未发布");
    const now = ctx.operationNow;
    const row: SessionRow = {
      id: randomUUID(),
      user_id: ctx.userId,
      course_id: courseId,
      status: "active",
      started_at: now,
      active_since: now,
      ended_at: null,
      business_date: null,
      accumulated_seconds: 0,
      active_duration_seconds: 0,
      duration_snapshot_seconds: course.estimated_duration_seconds,
      calories_snapshot_kcal: course.estimated_calories_kcal,
      reward_threshold_seconds: Math.ceil(
        course.estimated_duration_seconds * this.deps.rewardThresholdRatio,
      ),
      estimated_calories_kcal: 0,
      reward_eligible: 0,
      version: 1,
      created_at: now,
    };
    await this.repo.insertSession(tx, row);
    return sessionDto(row);
  }
  async current(tx: SqlTx, ctx: CommandContext) {
    const row = await this.repo.current(tx, ctx.userId);
    return {
      session: row ? sessionDto(row, ctx.operationNow) : null,
      serverNow: ctx.operationNow,
    };
  }
  async update(tx: SqlTx, ctx: CommandContext, id: string, body: unknown) {
    uuid(id);
    const o = object(body, ["action", "version"]);
    integer(o.version, 1, 2147483647);
    if (!["pause", "resume", "abandon"].includes(String(o.action)))
      fail(422, "INVALID_ACTION", "训练操作无效");
    const row = await this.repo.session(tx, ctx.userId, id);
    if (!row) fail(404, "WORKOUT_NOT_FOUND", "训练不存在");
    const next = transition(
      row,
      o.action as "pause" | "resume" | "abandon",
      Number(o.version),
      ctx.operationNow,
    );
    await this.repo.updateSession(tx, next, row.version);
    return sessionDto(next);
  }
  async complete(tx: SqlTx, ctx: CommandContext, id: string, body: unknown) {
    uuid(id);
    const o = object(body, ["version"]);
    integer(o.version, 1, 2147483647);
    const row = await this.repo.session(tx, ctx.userId, id);
    if (!row) fail(404, "WORKOUT_NOT_FOUND", "训练不存在");
    if (row.status === "completed")
      return {
        session: sessionDto(row),
        awards: row.reward_eligible
          ? await this.deps.awardsQuery.forWorkout(tx, ctx.userId, row.id)
          : [],
      };
    const next = transition(
      row,
      "complete",
      Number(o.version),
      ctx.operationNow,
    );
    await this.repo.updateSession(tx, next, row.version);
    // Same tx, after the terminal state exists. A failing PointsPort must roll back this entire command.
    const awards = next.reward_eligible
      ? (
          await this.deps.points.awardInTransaction(tx, ctx, {
            type: "workout_completed",
            sourceId: next.id,
          })
        ).awards
      : [];
    return { session: sessionDto(next), awards };
  }
  async createPlan(tx: SqlTx, ctx: CommandContext, body: unknown) {
    const o = object(body, ["templateId", "startDate"]);
    const id = uuid(o.templateId),
      start = date(o.startDate);
    const template = await this.repo.template(tx, id);
    if (!template) fail(404, "TEMPLATE_NOT_FOUND", "模板不存在或未发布");
    if (
      !template.days.length ||
      template.days.some(
        (d) =>
          d.dayOffset < 0 ||
          d.dayOffset > 27 ||
          (!d.restDay && !d.courseIds.length),
      )
    )
      fail(503, "INVALID_TEMPLATE", "模板日程不完整");
    const days = new Set(template.days.map((d) => d.dayOffset));
    for (let i = 0; i <= Math.max(...days); i++)
      if (!days.has(i))
        fail(503, "INVALID_TEMPLATE", "模板必须明确每一天的训练或休息安排");
    const ids = [...new Set(template.days.flatMap((d) => d.courseIds))].sort();
    for (const cid of ids) {
      const c = await this.repo.course(tx, cid, true);
      if (!c || c.status !== "published")
        fail(409, "TEMPLATE_COURSE_UNAVAILABLE", "模板课程已不可用");
    }
    return this.repo.replacePlan(tx, ctx.userId, template, start);
  }
  async plan(tx: SqlTx, ctx: CommandContext, week: string) {
    date(week);
    if (new Date(week + "T00:00:00Z").getUTCDay() !== 1)
      fail(422, "INVALID_WEEK_START", "周起始日期必须为上海周一");
    return { plan: await this.repo.plan(tx, ctx.userId, week) };
  }
  reminderDto(row: ReminderRow): TrainingReminderDto {
    return {
      id: row.id,
      enabled: row.enabled === 1,
      localTime: row.local_time.slice(0, 5),
      timezone: "Asia/Shanghai",
      weekdays: jsonArray<number>(row.weekdays),
      channels: jsonArray<TrainingReminderDto["channels"][number]>(
        row.channels,
      ),
      skipIfCompleted: row.skip_if_completed === 1,
      nextTriggerAt: row.next_trigger_at ? instant(row.next_trigger_at) : null,
      version: Number(row.version),
      deliveryCapability: {
        webPush: this.deps.capability.webPush,
        appPush: this.deps.capability.appPush,
      },
    };
  }
  async reminder(tx: SqlTx, ctx: CommandContext) {
    const row = await this.repo.reminder(tx, ctx.userId);
    return row ? this.reminderDto(row) : null;
  }
  async saveReminder(tx: SqlTx, ctx: CommandContext, body: unknown) {
    const input = reminderInput(body, this.deps.capability);
    const old = await this.repo.reminder(tx, ctx.userId, true);
    if ((old?.version ?? 0) !== input.version)
      fail(409, "VERSION_CONFLICT", "提醒设置已变化，请重新读取");
    const row: ReminderRow = {
      id: old?.id ?? randomUUID(),
      user_id: ctx.userId,
      enabled: input.enabled ? 1 : 0,
      local_time: input.localTime + ":00",
      timezone: "Asia/Shanghai",
      weekdays: input.weekdays,
      channels: input.channels,
      skip_if_completed: input.skipIfCompleted ? 1 : 0,
      next_trigger_at: input.enabled
        ? nextTrigger(input.localTime, input.weekdays, ctx.operationNow)
        : null,
      version: input.version + 1,
    };
    await this.repo.saveReminder(tx, row, input.version);
    return this.reminderDto(row);
  }
  async processDue(
    tx: SqlTx,
    ctx: CommandContext,
    expected: {
      reminderId: string;
      reminderVersion: number;
      scheduledAt: string;
    },
  ) {
    const r = await this.repo.reminder(tx, ctx.userId, true);
    if (
      !r ||
      !r.enabled ||
      r.id !== expected.reminderId ||
      r.version !== expected.reminderVersion ||
      !r.next_trigger_at ||
      instant(r.next_trigger_at) !== instant(expected.scheduledAt) ||
      Date.parse(expected.scheduledAt) > Date.parse(ctx.operationNow)
    )
      return { processed: false, notified: false };
    const skip =
      r.skip_if_completed === 1 &&
      (await this.repo.hasEffectiveWorkout(
        tx,
        ctx.userId,
        businessDate(expected.scheduledAt),
      ));
    const next = {
      ...r,
      weekdays: jsonArray<number>(r.weekdays),
      channels: jsonArray<TrainingReminderDto["channels"][number]>(r.channels),
      next_trigger_at: nextTrigger(
        r.local_time.slice(0, 5),
        jsonArray<number>(r.weekdays),
        ctx.operationNow,
      ),
    };
    // Advancing the schedule is not a user configuration edit: retain reminder version.
    await this.repo.saveReminder(tx, next, r.version);
    if (!skip)
      await this.deps.outbox.enqueueInTransaction(tx, {
        eventType: "training.reminder.due.v1",
        aggregateType: "training_reminder",
        aggregateId: r.id,
        schemaVersion: 1,
        eventKey: `training.reminder.due.v1:${r.id}:${r.version}:${instant(expected.scheduledAt)}`,
        payload: {
          reminderId: r.id,
          userId: r.user_id,
          reminderVersion: r.version,
          scheduledAt: instant(expected.scheduledAt),
        },
      });
    return { processed: true, notified: !skip };
  }
  async validateNotification(
    tx: SqlTx,
    payload: {
      reminderId: string;
      userId: string;
      reminderVersion: number;
      scheduledAt: string;
    },
  ) {
    const r = await this.repo.reminder(tx, payload.userId);
    if (
      !r ||
      !r.enabled ||
      r.id !== payload.reminderId ||
      r.version !== payload.reminderVersion ||
      !r.next_trigger_at ||
      Date.parse(instant(r.next_trigger_at)) <= Date.parse(payload.scheduledAt)
    )
      return null;
    return this.reminderDto(r);
  }
  async catalog(tx: SqlTx, q: ListQuery) {
    const page = await this.repo.courses(tx, q);
    return { ...page, items: page.items.map(courseDto) };
  }
  async course(tx: SqlTx, id: string) {
    uuid(id);
    const c = await this.repo.course(tx, id);
    if (!c || c.status !== "published")
      fail(404, "COURSE_NOT_FOUND", "课程不存在");
    return courseDto(c);
  }
  async adminCourse(
    tx: SqlTx,
    ctx: CommandContext,
    id: string | null,
    body: unknown,
    publish = false,
  ) {
    const o = publish
      ? object(body, ["version"])
      : validateCourse(body, id !== null);
    if (publish) integer(o.version, 1, 2147483647);
    const old = id ? await this.repo.course(tx, uuid(id), true) : null;
    if (id && !old) fail(404, "COURSE_NOT_FOUND", "课程不存在");
    if (old && old.version !== o.version)
      fail(409, "VERSION_CONFLICT", "课程已更新");
    const r: CourseRow = old
      ? { ...old }
      : {
          id: randomUUID(),
          title: "",
          category: "stretch",
          level: "beginner",
          description: "",
          cover_asset_id: null,
          video_asset_id: null,
          estimated_duration_seconds: 60,
          estimated_calories_kcal: 0,
          status: "draft",
          version: 0,
          created_at: ctx.operationNow,
        };
    const map = {
      title: "title",
      category: "category",
      level: "level",
      description: "description",
      coverAssetId: "cover_asset_id",
      videoAssetId: "video_asset_id",
      estimatedDurationSeconds: "estimated_duration_seconds",
      estimatedCaloriesKcal: "estimated_calories_kcal",
    } as const;
    for (const [key, col] of Object.entries(map))
      if (key in o) (r as unknown as Record<string, unknown>)[col] = o[key];
    if (publish) {
      if (!r.title.trim() || !r.description.trim())
        fail(422, "INVALID_COURSE", "发布前必须填写完整课程");
      r.status = "published";
    } else if (old) r.status = "draft";
    for (const [key, purpose] of [
      ["cover_asset_id", "course_cover"],
      ["video_asset_id", "course_video"],
    ] as const)
      if (r[key])
        await this.deps.media.assertReady(tx, {
          assetId: r[key]!,
          purpose,
          actorUserId: ctx.userId,
          access: "admin_material",
        });
    r.version++;
    await this.repo.saveCourse(tx, r, old?.version ?? null);
    await this.deps.audit.recordInTransaction(tx, ctx, {
      action: publish
        ? "training.course.publish"
        : old
          ? "training.course.update"
          : "training.course.create",
      resourceType: "training_course",
      resourceId: r.id,
      changeSummary: {
        changedFields: Object.keys(o).filter((k) => k !== "version"),
        version: r.version,
      },
    });
    return courseDto(r);
  }
  /** Call only after the read/command transaction has ended; signing URLs can perform external work. */
  async attachMedia(
    actorUserId: string | null,
    course: ReturnType<typeof courseDto>,
    assets: { coverAssetId: string | null; videoAssetId: string | null },
  ) {
    const result = { ...course };
    for (const [asset, purpose, target] of [
      [assets.coverAssetId, "course_cover", "coverUrl"],
      [assets.videoAssetId, "course_video", "videoUrl"],
    ] as const)
      if (asset)
        result[target] = (
          await this.deps.media.createReadUrl({
            assetId: asset,
            purpose,
            actorUserId,
            access: "public_display",
            expiresInSeconds: 300,
          })
        ).readUrl;
    return result;
  }
  queryPort(): TrainingQueryPort {
    return {
      days: (tx, user, start, end) => this.repo.days(tx, user, start, end),
      recommendedCourse: async (tx, user, day) => {
        const c = await this.repo.recommended(tx, user, day);
        return c ? courseDto(c) : null;
      },
    };
  }
}
