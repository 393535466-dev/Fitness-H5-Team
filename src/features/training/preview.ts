/** Opt-in UI demonstration only. No fetch, storage, auth, real points or push.
 * Enabled ONLY with NEXT_PUBLIC_M04_PREVIEW=true; a permanent banner identifies it.
 * Production never substitutes these fixtures for failed API responses. */
import {
  TrainingApiError,
  type TrainingApi,
  type CourseDto,
  type WorkoutSessionDto,
  type TrainingReminderDto,
  type PlanDto,
  type TemplateDto,
} from "./api";
const cid = "c0000000-0000-4000-8000-000000000001",
  tid = "c0000000-0000-4000-8000-000000000002";
const day = (v: number) => new Date(v + 8 * 3600000).toISOString().slice(0, 10);
export function createPreviewApi(): TrainingApi {
  if (process.env.NODE_ENV === "production")
    throw new Error("M04 preview fixtures must not be enabled in production");
  const courses: CourseDto[] = [
    {
      id: cid,
      title: "晨间全身舒展",
      category: "stretch",
      level: "beginner",
      description:
        "从缓慢呼吸开始，依次舒展肩颈、背部与下肢。动作保持舒适幅度，不追求拉伸疼痛。",
      coverUrl: null,
      videoUrl: null,
      estimatedDurationSeconds: 600,
      estimatedCaloriesKcal: 60,
      status: "published",
      version: 1,
    },
    {
      id: "c0000000-0000-4000-8000-000000000003",
      title: "轻力量 · 唤醒身体",
      category: "strength",
      level: "beginner",
      description:
        "以自重深蹲、靠墙俯卧撑和桥式，完成轻量循环。按自己的节奏休息。",
      coverUrl: null,
      videoUrl: null,
      estimatedDurationSeconds: 900,
      estimatedCaloriesKcal: 100,
      status: "published",
      version: 1,
    },
    {
      id: "c0000000-0000-4000-8000-000000000004",
      title: "活力有氧循环",
      category: "cardio",
      level: "intermediate",
      description: "交替快走、原地踏步和低冲击开合动作。保持均匀呼吸。",
      coverUrl: null,
      videoUrl: null,
      estimatedDurationSeconds: 1200,
      estimatedCaloriesKcal: 160,
      status: "published",
      version: 1,
    },
  ];
  const templates: TemplateDto[] = [
    {
      id: tid,
      title: "轻松开启 · 7 天运动节奏",
      description: "四天舒展，三天恢复。从一小步开始建立习惯。",
      days: Array.from({ length: 7 }, (_, i) => ({
        dayOffset: i,
        restDay: i % 2 === 1,
        courseIds: i % 2 === 0 ? [cid] : [],
      })),
    },
  ];
  let session: WorkoutSessionDto | null = null,
    reminder: TrainingReminderDto | null = null,
    plan: PlanDto | null = null,
    base = 0,
    activeAt = 0;
  const records: WorkoutSessionDto[] = [];
  function snapshot() {
    return session
      ? {
          ...session,
          activeDurationSeconds:
            base +
            (session.status === "active"
              ? Math.max(0, Math.floor((Date.now() - activeAt) / 1000))
              : 0),
        }
      : null;
  }
  function checked(id: string, version: number) {
    if (!session || session.id !== id)
      throw new TrainingApiError("WORKOUT_NOT_FOUND", "训练不存在", 404);
    if (session.version !== version)
      throw new TrainingApiError(
        "VERSION_CONFLICT",
        "训练状态已更新，请刷新",
        409,
      );
    if (!["active", "paused"].includes(session.status))
      throw new TrainingApiError("INVALID_WORKOUT_STATE", "训练已经结束", 409);
    return snapshot()!;
  }
  const terminal = (id: string, version: number, completed: boolean) => {
    const s = checked(id, version),
      c = courses.find((c) => c.id === s.courseId)!;
    session = {
      ...s,
      status: completed ? "completed" : "abandoned",
      endedAt: new Date().toISOString(),
      businessDate: day(Date.now()),
      rewardEligible:
        completed && s.activeDurationSeconds >= s.rewardThresholdSeconds,
      estimatedCaloriesKcal: completed
        ? Math.round(
            c.estimatedCaloriesKcal *
              Math.min(s.activeDurationSeconds / s.durationSnapshotSeconds, 1) *
              10,
          ) / 10
        : 0,
      version: s.version + 1,
    };
    base = s.activeDurationSeconds;
    records.push({ ...session });
    return { ...session };
  };
  function previewTrigger(time: string, weekdays: number[]) {
    const now = Date.now(),
      today = day(now);
    for (let n = 0; n <= 7; n++) {
      const d = new Date(Date.parse(today + "T00:00:00Z") + n * 86400000)
        .toISOString()
        .slice(0, 10);
      const candidate = new Date(d + "T" + time + ":00+08:00").toISOString();
      if (
        weekdays.includes(new Date(d + "T00:00:00Z").getUTCDay() || 7) &&
        Date.parse(candidate) > now
      )
        return candidate;
    }
    return null;
  }
  return {
    courses: async (q) => ({
      items: courses.filter(
        (c) =>
          (!q.category || c.category === q.category) &&
          (!q.level || c.level === q.level) &&
          (!q.keyword || c.title.includes(q.keyword)),
      ),
      nextCursor: null,
    }),
    course: async (id) => {
      const c = courses.find((c) => c.id === id);
      if (!c) throw new TrainingApiError("COURSE_NOT_FOUND", "课程不存在", 404);
      return { ...c };
    },
    templates: async () => ({ items: templates, nextCursor: null }),
    plan: async (week) => ({
      plan: plan
        ? {
            ...plan,
            items: plan.items.filter(
              (i) =>
                i.scheduledDate >= week &&
                i.scheduledDate <=
                  new Date(Date.parse(week) + 6 * 86400000)
                    .toISOString()
                    .slice(0, 10),
            ),
          }
        : null,
    }),
    createPlan: async (templateId, startDate) => {
      const t = templates.find((t) => t.id === templateId)!;
      plan = {
        id: crypto.randomUUID(),
        templateId,
        title: t.title,
        startDate,
        endDate: new Date(Date.parse(startDate) + 6 * 86400000)
          .toISOString()
          .slice(0, 10),
        status: "active",
        items: t.days.map((d) => ({
          id: crypto.randomUUID(),
          scheduledDate: new Date(
            Date.parse(startDate) + d.dayOffset * 86400000,
          )
            .toISOString()
            .slice(0, 10),
          courseId: d.restDay ? null : cid,
          restDay: d.restDay,
          sortOrder: 0,
        })),
      };
      return structuredClone(plan);
    },
    current: async () => ({
      session:
        session && ["active", "paused"].includes(session.status)
          ? snapshot()
          : null,
      serverNow: new Date().toISOString(),
    }),
    history: async (start, end) => ({
      items: [
        ...records,
        ...(session && ["active", "paused"].includes(session.status)
          ? [snapshot()!]
          : []),
      ]
        .filter((s) => {
          const d = s.businessDate ?? day(Date.parse(s.startedAt));
          return d >= start && d <= end;
        })
        .reverse(),
      nextCursor: null,
    }),
    start: async (id) => {
      if (session && ["active", "paused"].includes(session.status))
        throw new TrainingApiError(
          "WORKOUT_IN_PROGRESS",
          "已有训练，请恢复",
          409,
        );
      const c = courses.find((c) => c.id === id)!;
      session = {
        id: crypto.randomUUID(),
        courseId: id,
        status: "active",
        startedAt: new Date().toISOString(),
        endedAt: null,
        activeDurationSeconds: 0,
        estimatedCaloriesKcal: 0,
        businessDate: null,
        durationSnapshotSeconds: c.estimatedDurationSeconds,
        rewardThresholdSeconds: Math.ceil(c.estimatedDurationSeconds * 0.8),
        rewardEligible: false,
        version: 1,
      };
      base = 0;
      activeAt = Date.now();
      return { ...session };
    },
    update: async (id, action, version) => {
      if (action === "abandon") return terminal(id, version, false);
      const s = checked(id, version);
      if (
        (action === "pause" && s.status !== "active") ||
        (action === "resume" && s.status !== "paused")
      )
        throw new TrainingApiError(
          "INVALID_WORKOUT_STATE",
          "当前状态不可操作",
          409,
        );
      base = s.activeDurationSeconds;
      activeAt = Date.now();
      session = {
        ...s,
        status: action === "pause" ? "paused" : "active",
        version: s.version + 1,
      };
      return { ...session };
    },
    complete: async (id, version) => ({
      session: terminal(id, version, true),
      awards: [],
    }),
    reminder: async () => (reminder ? structuredClone(reminder) : null),
    saveReminder: async (input) => {
      if ((reminder?.version ?? 0) !== input.version)
        throw new TrainingApiError("VERSION_CONFLICT", "提醒已更新", 409);
      reminder = {
        ...structuredClone(input),
        id: reminder?.id ?? crypto.randomUUID(),
        version: input.version + 1,
        nextTriggerAt: input.enabled
          ? previewTrigger(input.localTime, input.weekdays)
          : null,
        deliveryCapability: { webPush: false, appPush: false },
      };
      return structuredClone(reminder);
    },
    invalidateHealth: () => {},
  };
}
