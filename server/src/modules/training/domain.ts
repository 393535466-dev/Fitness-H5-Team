import type {
  CourseDto,
  CourseRow,
  SessionRow,
  WorkoutSessionDto,
  TrainingReminderInput,
  Capability,
} from "./types";
export class TrainingError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}
export function fail(
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): never {
  throw new TrainingError(status, code, message, undefined, details);
}
export function object(
  value: unknown,
  allowed: string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(422, "INVALID_INPUT", "请求必须是对象");
  const o = value as Record<string, unknown>;
  for (const k of Object.keys(o))
    if (!allowed.includes(k)) fail(422, "UNKNOWN_FIELD", `不支持字段：${k}`);
  return o;
}
export function uuid(v: unknown): string {
  if (
    typeof v !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      v,
    )
  )
    fail(422, "INVALID_UUID", "编号必须是小写 UUID v4");
  return v;
}
export function integer(v: unknown, min: number, max: number): number {
  if (!Number.isSafeInteger(v) || Number(v) < min || Number(v) > max)
    fail(422, "INVALID_INPUT", `整数范围应为 ${min}—${max}`);
  return Number(v);
}
export function date(v: unknown): string {
  if (
    typeof v !== "string" ||
    !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(v) ||
    !Number.isFinite(Date.parse(v + "T00:00:00Z")) ||
    new Date(v + "T00:00:00Z").toISOString().slice(0, 10) !== v
  )
    fail(422, "INVALID_DATE", "日期格式应为有效的 YYYY-MM-DD");
  return v;
}
export function instant(v: string): string {
  const raw =
    v.endsWith("Z") || /[+-]\d\d:\d\d$/.test(v) ? v : v.replace(" ", "T") + "Z";
  const n = Date.parse(raw);
  if (!Number.isFinite(n)) fail(503, "INVALID_SERVER_TIME", "服务端时间无效");
  return new Date(n).toISOString();
}
export const sqlTime = (v: string) => instant(v).slice(0, 23).replace("T", " ");
export const businessDate = (v: string) =>
  new Date(Date.parse(instant(v)) + 8 * 3600_000).toISOString().slice(0, 10);
export const plusDays = (v: string, n: number) =>
  new Date(Date.parse(date(v) + "T00:00:00Z") + n * 86400_000)
    .toISOString()
    .slice(0, 10);
export function settled(row: SessionRow, now: string): number {
  const delta =
    row.status === "active"
      ? Date.parse(instant(now)) - Date.parse(instant(row.active_since!))
      : 0;
  if (
    delta < 0 ||
    Date.parse(instant(now)) <
      Date.parse(instant(row.updated_at ?? row.started_at))
  )
    fail(503, "CLOCK_MOVED_BACKWARDS", "服务端时钟异常，请稍后重试");
  return Number(row.accumulated_seconds) + Math.floor(delta / 1000);
}
export function sessionDto(r: SessionRow, now?: string): WorkoutSessionDto {
  return {
    id: r.id,
    courseId: r.course_id,
    status: r.status,
    startedAt: instant(r.started_at),
    endedAt: r.ended_at ? instant(r.ended_at) : null,
    activeDurationSeconds: now
      ? settled(r, now)
      : Number(r.active_duration_seconds),
    estimatedCaloriesKcal: Number(r.estimated_calories_kcal),
    businessDate: r.business_date,
    durationSnapshotSeconds: Number(r.duration_snapshot_seconds),
    rewardThresholdSeconds: Number(r.reward_threshold_seconds),
    rewardEligible: r.reward_eligible === 1,
    version: Number(r.version),
  };
}
export function transition(
  row: SessionRow,
  action: "pause" | "resume" | "abandon" | "complete",
  version: number,
  now: string,
): SessionRow {
  if (row.version !== version)
    fail(409, "VERSION_CONFLICT", "训练状态已更新，请刷新后重试");
  if (
    !["active", "paused"].includes(row.status) ||
    (action === "pause" && row.status !== "active") ||
    (action === "resume" && row.status !== "paused")
  )
    fail(409, "INVALID_WORKOUT_STATE", "当前状态不允许此操作");
  const n = settled(row, now);
  const terminal = action === "complete" || action === "abandon";
  return {
    ...row,
    status:
      action === "pause"
        ? "paused"
        : action === "resume"
          ? "active"
          : action === "complete"
            ? "completed"
            : "abandoned",
    accumulated_seconds: n,
    active_duration_seconds: n,
    active_since: action === "resume" ? instant(now) : null,
    ended_at: terminal ? instant(now) : null,
    business_date: terminal ? businessDate(now) : null,
    version: row.version + 1,
    updated_at: instant(now),
    estimated_calories_kcal:
      action === "complete"
        ? Math.round(
            Number(row.calories_snapshot_kcal) *
              Math.min(n / row.duration_snapshot_seconds, 1) *
              10,
          ) / 10
        : 0,
    reward_eligible:
      action === "complete" && n >= row.reward_threshold_seconds ? 1 : 0,
  };
}
export function reminderInput(
  v: unknown,
  cap: Capability,
): TrainingReminderInput {
  const o = object(v, [
    "enabled",
    "localTime",
    "timezone",
    "weekdays",
    "channels",
    "skipIfCompleted",
    "version",
  ]);
  if (
    typeof o.enabled !== "boolean" ||
    typeof o.skipIfCompleted !== "boolean" ||
    o.timezone !== "Asia/Shanghai" ||
    typeof o.localTime !== "string" ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(o.localTime)
  )
    fail(422, "INVALID_REMINDER", "请检查提醒时间、时区与开关");
  const version = integer(o.version, 0, 2147483647);
  if (
    !Array.isArray(o.weekdays) ||
    o.weekdays.length > 7 ||
    o.weekdays.some((d) => !Number.isInteger(d) || d < 1 || d > 7) ||
    new Set(o.weekdays).size !== o.weekdays.length
  )
    fail(422, "INVALID_WEEKDAYS", "星期应为不重复的 1—7");
  const choices = ["in_app", "web_push", "app_push"];
  if (
    !Array.isArray(o.channels) ||
    o.channels.length > 3 ||
    o.channels.some((c) => !choices.includes(c)) ||
    new Set(o.channels).size !== o.channels.length
  )
    fail(422, "INVALID_CHANNELS", "提醒通道无效或重复");
  if (
    o.channels.some(
      (c) =>
        (c === "in_app" && !cap.inApp) ||
        (c === "web_push" && !cap.webPush) ||
        (c === "app_push" && !cap.appPush),
    )
  )
    fail(422, "UNSUPPORTED_CHANNEL", "所选提醒通道尚未接入", {
      deliveryCapability: { webPush: cap.webPush, appPush: cap.appPush },
    });
  if (o.enabled && (!o.weekdays.length || !o.channels.length))
    fail(422, "INVALID_REMINDER", "开启提醒时至少选择一天和一个通道");
  return {
    ...o,
    version,
    weekdays: [...o.weekdays].sort((a, b) => a - b),
    channels: o.channels,
  } as TrainingReminderInput;
}
export function nextTrigger(
  localTime: string,
  weekdays: number[],
  after: string,
): string {
  const day = businessDate(after);
  for (let offset = 0; offset <= 7; offset++) {
    const d = plusDays(day, offset);
    const dow = new Date(d + "T00:00:00Z").getUTCDay() || 7;
    const candidate = new Date(d + "T" + localTime + ":00+08:00").toISOString();
    if (
      weekdays.includes(dow) &&
      Date.parse(candidate) > Date.parse(instant(after))
    )
      return candidate;
  }
  return fail(422, "INVALID_WEEKDAYS", "未找到可用提醒日期");
}
export const courseDto = (r: CourseRow): CourseDto => ({
  id: r.id,
  title: r.title,
  category: r.category,
  level: r.level,
  description: r.description,
  coverUrl: null,
  videoUrl: null,
  estimatedDurationSeconds: Number(r.estimated_duration_seconds),
  estimatedCaloriesKcal: Number(r.estimated_calories_kcal),
  status: r.status,
  version: Number(r.version),
});
export function validateCourse(value: unknown, patch = false) {
  const keys = [
    "title",
    "category",
    "level",
    "description",
    "coverAssetId",
    "videoAssetId",
    "estimatedDurationSeconds",
    "estimatedCaloriesKcal",
  ];
  const o = object(value, patch ? [...keys, "version"] : keys);
  if (patch) integer(o.version, 1, 2147483647);
  if (
    !patch &&
    keys.filter((k) => !k.endsWith("AssetId")).some((k) => !(k in o))
  )
    fail(422, "INVALID_COURSE", "课程资料不完整");
  if (
    "title" in o &&
    (typeof o.title !== "string" || !o.title.trim() || o.title.length > 100)
  )
    fail(422, "INVALID_COURSE", "标题应为 1—100 字");
  if (
    "description" in o &&
    (typeof o.description !== "string" ||
      !o.description.trim() ||
      o.description.length > 20000 ||
      Buffer.byteLength(o.description, "utf8") > 65535)
  )
    fail(422, "INVALID_COURSE", "请填写课程说明，最多 20000 字");
  if (
    "category" in o &&
    !["stretch", "strength", "cardio"].includes(String(o.category))
  )
    fail(422, "INVALID_COURSE", "课程分类无效");
  if ("level" in o && !["beginner", "intermediate"].includes(String(o.level)))
    fail(422, "INVALID_COURSE", "课程难度无效");
  if ("estimatedDurationSeconds" in o)
    integer(o.estimatedDurationSeconds, 60, 14400);
  if (
    "estimatedCaloriesKcal" in o &&
    (typeof o.estimatedCaloriesKcal !== "number" ||
      !Number.isFinite(o.estimatedCaloriesKcal) ||
      o.estimatedCaloriesKcal < 0 ||
      o.estimatedCaloriesKcal > 999999.9 ||
      Math.abs(
        o.estimatedCaloriesKcal * 10 - Math.round(o.estimatedCaloriesKcal * 10),
      ) > 1e-7)
  )
    fail(422, "INVALID_COURSE", "热量应为非负数，最多一位小数");
  for (const k of ["coverAssetId", "videoAssetId"])
    if (k in o && o[k] !== null) uuid(o[k]);
  return o;
}
