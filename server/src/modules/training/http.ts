import type { CommandContext, SqlTx, CourseDto } from "./types";
import type { ListQuery } from "./repository";
import { TrainingService } from "./service";
import { object, integer, fail, sessionDto, courseDto } from "./domain";

export interface TrainingRequest {
  body?: unknown;
  query?: Record<string, unknown>;
  params?: Record<string, string>;
  headers: Record<string, unknown>;
}
export interface TrainingResponse {
  status: number;
  body: unknown;
}
export interface RoutePolicy {
  method: "GET" | "POST" | "PATCH" | "PUT";
  path: string;
  access: "public" | "user" | "admin";
  status: number;
  idempotent: boolean;
}
/** M01 must authenticate/authorize, check platform+CSRF, claim/replay POST keys,
 * run user commands under users -> idempotency -> resources, wrap the envelope,
 * normalize errors, and commit the cached response in that SAME transaction.
 * This port deliberately has no fallback authentication or transaction manager. */
export interface TrainingExecutionPort {
  execute<T>(
    request: TrainingRequest,
    policy: RoutePolicy,
    run: (tx: SqlTx, ctx: CommandContext) => Promise<T>,
  ): Promise<TrainingResponse>;
}
type Handler = (
  tx: SqlTx,
  ctx: CommandContext,
  req: TrainingRequest,
) => Promise<unknown>;
export interface TrainingRoute extends RoutePolicy {
  run: Handler;
}
function query(
  req: TrainingRequest,
  kind: "courses" | "templates" | "history",
): ListQuery {
  const allowed =
    kind === "courses"
      ? ["category", "level", "keyword", "limit", "cursor"]
      : kind === "history"
        ? ["startDate", "endDate", "status", "limit", "cursor"]
        : ["limit", "cursor"];
  const q = object(req.query ?? {}, allowed);
  const result: ListQuery = {};
  for (const [k, v] of Object.entries(q)) {
    if (typeof v !== "string")
      fail(422, "INVALID_QUERY", "查询参数必须是单个字符串");
    if (k === "limit") {
      if (!/^\d+$/.test(v)) fail(422, "INVALID_LIMIT", "分页大小无效");
      result.limit = integer(Number(v), 1, 100);
    } else (result as Record<string, unknown>)[k] = v;
  }
  if (
    result.category &&
    !["stretch", "strength", "cardio"].includes(result.category)
  )
    fail(422, "INVALID_CATEGORY", "课程分类无效");
  if (result.level && !["beginner", "intermediate"].includes(result.level))
    fail(422, "INVALID_LEVEL", "课程难度无效");
  if (
    result.status &&
    !["active", "paused", "completed", "abandoned"].includes(result.status)
  )
    fail(422, "INVALID_STATUS", "训练状态无效");
  if (result.keyword && result.keyword.length > 100)
    fail(422, "INVALID_KEYWORD", "关键词最多100字");
  if (result.cursor && result.cursor.length > 2048)
    fail(422, "INVALID_CURSOR", "游标过长");
  return result;
}
export function trainingRoutes(service: TrainingService): TrainingRoute[] {
  const r = (
    method: RoutePolicy["method"],
    path: string,
    access: RoutePolicy["access"],
    status: number,
    run: Handler,
  ): TrainingRoute => ({
    method,
    path,
    access,
    status,
    idempotent: method === "POST",
    run,
  });
  return [
    r("POST", "admin/training/courses", "admin", 201, (tx, c, r) =>
      service.adminCourse(tx, c, null, r.body),
    ),
    r("PATCH", "admin/training/courses/:id", "admin", 200, (tx, c, r) =>
      service.adminCourse(tx, c, r.params!.id, r.body),
    ),
    r("POST", "admin/training/courses/:id/publish", "admin", 200, (tx, c, r) =>
      service.adminCourse(tx, c, r.params!.id, r.body, true),
    ),
    r("GET", "me/training-plan", "user", 200, (tx, c, r) => {
      const q = object(r.query ?? {}, ["weekStart"]);
      return service.plan(tx, c, String(q.weekStart ?? ""));
    }),
    r("POST", "me/training-plans", "user", 201, (tx, c, r) =>
      service.createPlan(tx, c, r.body),
    ),
    r("GET", "me/training-reminder", "user", 200, (tx, c) =>
      service.reminder(tx, c),
    ),
    r("PUT", "me/training-reminder", "user", 200, (tx, c, r) =>
      service.saveReminder(tx, c, r.body),
    ),
    // Keep /current before /:id for frameworks that match in declaration order.
    r("GET", "me/workout-sessions/current", "user", 200, (tx, c) =>
      service.current(tx, c),
    ),
    r("GET", "me/workout-sessions", "user", 200, async (tx, c, r) => {
      const p = await service.repo.sessions(tx, c.userId, query(r, "history"));
      return { ...p, items: p.items.map((x) => sessionDto(x, c.operationNow)) };
    }),
    r("POST", "me/workout-sessions", "user", 201, (tx, c, r) =>
      service.start(tx, c, r.body),
    ),
    r("PATCH", "me/workout-sessions/:id", "user", 200, (tx, c, r) =>
      service.update(tx, c, r.params!.id, r.body),
    ),
    r("POST", "me/workout-sessions/:id/complete", "user", 200, (tx, c, r) =>
      service.complete(tx, c, r.params!.id, r.body),
    ),
    r("GET", "training/courses", "public", 200, (tx, _c, r) =>
      service.catalog(tx, query(r, "courses")),
    ),
    r("GET", "training/courses/:id", "public", 200, (tx, _c, r) =>
      service.course(tx, r.params!.id),
    ),
    r("GET", "training/plan-templates", "public", 200, (tx, _c, r) =>
      service.repo.templates(tx, query(r, "templates")),
    ),
  ];
}
/** Signs only published public reads, after M01 has ended the snapshot transaction. */
export function trainingHandler(
  service: TrainingService,
  executor: TrainingExecutionPort,
  route: TrainingRoute,
) {
  return async (req: TrainingRequest): Promise<TrainingResponse> => {
    const assets = new Map<
      string,
      { coverAssetId: string | null; videoAssetId: string | null }
    >();
    const response = await executor.execute(req, route, async (tx, ctx) => {
      const queryRoutes = [
        "me/training-plan",
        "me/workout-sessions",
        "training/courses",
        "training/plan-templates",
      ];
      if (route.method !== "GET" || !queryRoutes.includes(route.path))
        object(req.query ?? {}, []);
      const data = await route.run(tx, ctx, req);
      if (route.method === "GET" && route.path.startsWith("training/courses")) {
        const courses = route.path.endsWith(":id")
          ? [data as CourseDto]
          : (data as { items: CourseDto[] }).items;
        for (const c of courses) {
          const row = await service.repo.course(tx, c.id);
          if (row?.status === "published")
            assets.set(c.id, {
              coverAssetId: row.cover_asset_id,
              videoAssetId: row.video_asset_id,
            });
        }
      }
      return data;
    });
    if (response.status >= 200 && response.status < 300 && assets.size) {
      const envelope = response.body as {
        data: CourseDto | { items: CourseDto[] };
      };
      const sign = (c: CourseDto) =>
        service.attachMedia(null, c, assets.get(c.id)!);
      if ("items" in envelope.data)
        envelope.data.items = await Promise.all(envelope.data.items.map(sign));
      else envelope.data = await sign(envelope.data);
    }
    return response;
  };
}
