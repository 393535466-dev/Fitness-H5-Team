import type {
  CourseDto,
  WorkoutSessionDto,
  CurrentWorkoutDto,
  TrainingReminderInput,
  TrainingReminderDto,
  Envelope,
  CursorPage,
} from "../../../docs/M04/reference/shared-types";
import type {
  PlanDto,
  TemplateDto,
  CompletionDto,
} from "../../../server/src/modules/training/types";
export type {
  CourseDto,
  WorkoutSessionDto,
  TrainingReminderInput,
  TrainingReminderDto,
  PlanDto,
  TemplateDto,
  CompletionDto,
};
export interface SharedTrainingTransport {
  /** M01 handles same-site cookies, CSRF, platform, one login refresh, envelopes and errors. */
  request<T>(input: {
    method: "GET" | "POST" | "PATCH" | "PUT";
    path: string;
    body?: unknown;
    idempotencyKey?: string;
  }): Promise<Envelope<T>>;
  invalidateHealth(date: string): void | Promise<void>;
}
export interface TrainingApi {
  courses(query: {
    category?: string;
    level?: string;
    keyword?: string;
    cursor?: string;
  }): Promise<CursorPage<CourseDto>>;
  course(id: string): Promise<CourseDto>;
  templates(cursor?: string): Promise<CursorPage<TemplateDto>>;
  plan(weekStart: string): Promise<{ plan: PlanDto | null }>;
  createPlan(
    templateId: string,
    startDate: string,
    key: string,
  ): Promise<PlanDto>;
  current(): Promise<CurrentWorkoutDto>;
  history(
    startDate: string,
    endDate: string,
    cursor?: string,
  ): Promise<CursorPage<WorkoutSessionDto>>;
  start(courseId: string, key: string): Promise<WorkoutSessionDto>;
  update(
    id: string,
    action: "pause" | "resume" | "abandon",
    version: number,
  ): Promise<WorkoutSessionDto>;
  complete(id: string, version: number, key: string): Promise<CompletionDto>;
  reminder(): Promise<TrainingReminderDto | null>;
  saveReminder(input: TrainingReminderInput): Promise<TrainingReminderDto>;
  invalidateHealth(date: string): void | Promise<void>;
}
export class TrainingApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export function createTrainingApi(
  shared: SharedTrainingTransport,
): TrainingApi {
  const get = async <T>(path: string) =>
    (await shared.request<T>({ method: "GET", path: "/api/v1" + path })).data;
  const command = async <T>(
    method: "POST" | "PUT" | "PATCH",
    path: string,
    body: unknown,
    key?: string,
  ) =>
    (
      await shared.request<T>({
        method,
        path: "/api/v1" + path,
        body,
        idempotencyKey: key,
      })
    ).data;
  const qs = (q: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v) p.set(k, v);
    return "?" + p;
  };
  return {
    courses: (q) => get("/training/courses" + qs(q)),
    course: (id) => get("/training/courses/" + encodeURIComponent(id)),
    templates: (cursor) => get("/training/plan-templates" + qs({ cursor })),
    plan: (weekStart) => get("/me/training-plan" + qs({ weekStart })),
    createPlan: (templateId, startDate, key) =>
      command("POST", "/me/training-plans", { templateId, startDate }, key),
    current: () => get("/me/workout-sessions/current"),
    history: (startDate, endDate, cursor) =>
      get("/me/workout-sessions" + qs({ startDate, endDate, cursor })),
    start: (courseId, key) =>
      command("POST", "/me/workout-sessions", { courseId }, key),
    update: (id, action, version) =>
      command("PATCH", `/me/workout-sessions/${id}`, { action, version }),
    complete: (id, version, key) =>
      command("POST", `/me/workout-sessions/${id}/complete`, { version }, key),
    reminder: () => get("/me/training-reminder"),
    saveReminder: (input) => command("PUT", "/me/training-reminder", input),
    invalidateHealth: (d) => shared.invalidateHealth(d),
  };
}
