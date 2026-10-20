import { randomUUID, createHash } from "node:crypto";
import type {
  SqlTx,
  CourseRow,
  SessionRow,
  ReminderRow,
  TemplateDto,
  PlanDto,
  TrainingDay,
} from "./types";
import {
  date,
  integer,
  fail,
  instant,
  sqlTime,
  plusDays,
  uuid,
} from "./domain";
export interface ListQuery {
  limit?: number;
  cursor?: string;
  category?: string;
  level?: string;
  keyword?: string;
  startDate?: string;
  endDate?: string;
  status?: string;
}
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
export interface TrainingRepository {
  course(tx: SqlTx, id: string, lock?: boolean): Promise<CourseRow | null>;
  courses(tx: SqlTx, q: ListQuery): Promise<Page<CourseRow>>;
  templates(tx: SqlTx, q: ListQuery): Promise<Page<TemplateDto>>;
  template(tx: SqlTx, id: string): Promise<TemplateDto | null>;
  current(
    tx: SqlTx,
    userId: string,
    lock?: boolean,
  ): Promise<SessionRow | null>;
  session(tx: SqlTx, userId: string, id: string): Promise<SessionRow | null>;
  sessions(tx: SqlTx, userId: string, q: ListQuery): Promise<Page<SessionRow>>;
  insertSession(tx: SqlTx, r: SessionRow): Promise<void>;
  updateSession(tx: SqlTx, r: SessionRow, oldVersion: number): Promise<void>;
  plan(tx: SqlTx, userId: string, weekStart: string): Promise<PlanDto | null>;
  replacePlan(
    tx: SqlTx,
    userId: string,
    template: TemplateDto,
    startDate: string,
  ): Promise<PlanDto>;
  reminder(
    tx: SqlTx,
    userId: string,
    lock?: boolean,
  ): Promise<ReminderRow | null>;
  saveReminder(tx: SqlTx, r: ReminderRow, expected: number): Promise<void>;
  due(tx: SqlTx, now: string, limit: number): Promise<ReminderRow[]>;
  hasEffectiveWorkout(tx: SqlTx, userId: string, day: string): Promise<boolean>;
  days(
    tx: SqlTx,
    userId: string,
    start: string,
    end: string,
  ): Promise<TrainingDay[]>;
  recommended(
    tx: SqlTx,
    userId: string,
    day: string,
  ): Promise<CourseRow | null>;
  saveCourse(tx: SqlTx, row: CourseRow, expected: number | null): Promise<void>;
}
const first = async <T extends object>(
  tx: SqlTx,
  sql: string,
  params: Parameters<SqlTx["query"]>[1],
) => (await tx.query<T>(sql, params))[0] ?? null;
function paging(q: ListQuery, scope: unknown) {
  const limit = integer(q.limit ?? 20, 1, 100);
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(scope))
    .digest("hex");
  let after: { created: string; id: string } | null = null;
  if (q.cursor) {
    try {
      const a = JSON.parse(Buffer.from(q.cursor, "base64url").toString());
      if (
        a.filter !== fingerprint ||
        typeof a.created !== "string" ||
        typeof a.id !== "string"
      )
        throw Error();
      after = { created: sqlTime(a.created), id: uuid(a.id) };
    } catch {
      fail(422, "INVALID_CURSOR", "游标无效或筛选条件已改变");
    }
  }
  return {
    limit,
    after,
    finish<T extends { id: string; created_at: string }>(rows: T[]): Page<T> {
      const items = rows.slice(0, limit),
        last = items.at(-1);
      return {
        items,
        nextCursor:
          rows.length > limit && last
            ? Buffer.from(
                JSON.stringify({
                  created: instant(last.created_at),
                  id: last.id,
                  filter: fingerprint,
                }),
              ).toString("base64url")
            : null,
      };
    },
  };
}
export class SqlTrainingRepository implements TrainingRepository {
  course(tx: SqlTx, id: string, lock = false) {
    return first<CourseRow>(
      tx,
      `SELECT * FROM training_courses WHERE id=?${lock ? " FOR UPDATE" : ""}`,
      [id],
    );
  }
  async courses(tx: SqlTx, q: ListQuery) {
    const pg = paging(q, [
      "courses",
      q.category ?? null,
      q.level ?? null,
      q.keyword ?? null,
    ]);
    const clauses = ["status='published'"];
    const params: (string | number)[] = [];
    for (const key of ["category", "level"] as const)
      if (q[key]) {
        clauses.push(`${key}=?`);
        params.push(q[key]!);
      }
    if (q.keyword) {
      clauses.push("title LIKE ? ESCAPE '='");
      params.push("%" + q.keyword.replace(/[=%_]/g, (x) => "=" + x) + "%");
    }
    if (pg.after) {
      clauses.push("(created_at < ? OR (created_at=? AND id<?))");
      params.push(pg.after.created, pg.after.created, pg.after.id);
    }
    return pg.finish(
      await tx.query<CourseRow>(
        `SELECT * FROM training_courses WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC,id DESC LIMIT ?`,
        [...params, pg.limit + 1],
      ),
    );
  }
  async template(tx: SqlTx, id: string) {
    const row = await first<{ id: string; title: string; description: string }>(
      tx,
      "SELECT id,title,description FROM training_plan_templates WHERE id=? AND status='published'",
      [id],
    );
    if (!row) return null;
    const items = await tx.query<{
      day_offset: number;
      rest_day: 0 | 1;
      course_id: string | null;
    }>(
      "SELECT day_offset,rest_day,course_id FROM training_template_items WHERE template_id=? ORDER BY day_offset,sort_order,id",
      [id],
    );
    const days: TemplateDto["days"] = [];
    for (const item of items) {
      let d = days.find((d) => d.dayOffset === item.day_offset);
      if (!d) {
        d = {
          dayOffset: item.day_offset,
          restDay: item.rest_day === 1,
          courseIds: [],
        };
        days.push(d);
      }
      if (d.restDay !== (item.rest_day === 1))
        fail(503, "INVALID_TEMPLATE", "模板同一天不能同时为休息和训练");
      if (item.course_id) d.courseIds.push(item.course_id);
    }
    return { ...row, days };
  }
  async templates(tx: SqlTx, q: ListQuery) {
    const pg = paging(q, ["templates"]);
    let clause = "";
    let args: string[] = [];
    if (pg.after) {
      clause = " AND (created_at<? OR (created_at=? AND id<?))";
      args = [pg.after.created, pg.after.created, pg.after.id];
    }
    const rows = await tx.query<{ id: string; created_at: string }>(
      `SELECT id,created_at FROM training_plan_templates WHERE status='published'${clause} ORDER BY created_at DESC,id DESC LIMIT ?`,
      [...args, pg.limit + 1],
    );
    const page = pg.finish(rows);
    const items: TemplateDto[] = [];
    for (const r of page.items) {
      const t = await this.template(tx, r.id);
      if (t) items.push(t);
    }
    return { items, nextCursor: page.nextCursor };
  }
  current(tx: SqlTx, user: string, lock = false) {
    return first<SessionRow>(
      tx,
      `SELECT * FROM workout_sessions WHERE user_id=? AND status IN ('active','paused')${lock ? " FOR UPDATE" : ""}`,
      [user],
    );
  }
  session(tx: SqlTx, user: string, id: string) {
    return first<SessionRow>(
      tx,
      "SELECT * FROM workout_sessions WHERE user_id=? AND id=? FOR UPDATE",
      [user, id],
    );
  }
  async sessions(tx: SqlTx, user: string, q: ListQuery) {
    const start = date(q.startDate),
      end = date(q.endDate);
    if (end < start || Date.parse(end) - Date.parse(start) > 365 * 86400_000)
      fail(422, "INVALID_DATE_RANGE", "记录范围最多 366 天");
    const pg = paging(q, ["sessions", user, start, end, q.status ?? null]);
    let clause = "";
    const params: (string | number)[] = [user, start, end];
    if (q.status) {
      clause += " AND status=?";
      params.push(q.status);
    }
    if (pg.after) {
      clause += " AND (created_at<? OR (created_at=? AND id<?))";
      params.push(pg.after.created, pg.after.created, pg.after.id);
    }
    return pg.finish(
      await tx.query<SessionRow>(
        `SELECT * FROM workout_sessions WHERE user_id=? AND COALESCE(business_date,DATE(DATE_ADD(started_at,INTERVAL 8 HOUR))) BETWEEN ? AND ?${clause} ORDER BY created_at DESC,id DESC LIMIT ?`,
        [...params, pg.limit + 1],
      ),
    );
  }
  async insertSession(tx: SqlTx, r: SessionRow) {
    await tx.execute(
      `INSERT INTO workout_sessions (id,user_id,course_id,status,started_at,active_since,accumulated_seconds,active_duration_seconds,duration_snapshot_seconds,calories_snapshot_kcal,reward_threshold_seconds,estimated_calories_kcal,reward_eligible,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        r.id,
        r.user_id,
        r.course_id,
        r.status,
        sqlTime(r.started_at),
        sqlTime(r.active_since!),
        0,
        0,
        r.duration_snapshot_seconds,
        Number(r.calories_snapshot_kcal),
        r.reward_threshold_seconds,
        0,
        0,
        1,
        sqlTime(r.created_at),
        sqlTime(r.created_at),
      ],
    );
  }
  async updateSession(tx: SqlTx, r: SessionRow, old: number) {
    const result = await tx.execute(
      "UPDATE workout_sessions SET status=?,active_since=?,accumulated_seconds=?,active_duration_seconds=?,ended_at=?,business_date=?,estimated_calories_kcal=?,reward_eligible=?,version=?,updated_at=? WHERE id=? AND user_id=? AND version=?",
      [
        r.status,
        r.active_since ? sqlTime(r.active_since) : null,
        r.accumulated_seconds,
        r.active_duration_seconds,
        r.ended_at ? sqlTime(r.ended_at) : null,
        r.business_date,
        Number(r.estimated_calories_kcal),
        r.reward_eligible,
        r.version,
        sqlTime(r.updated_at!),
        r.id,
        r.user_id,
        old,
      ],
    );
    if (result.affectedRows !== 1)
      fail(409, "VERSION_CONFLICT", "训练状态已更新");
  }
  async plan(tx: SqlTx, user: string, week: string) {
    const r = await first<{
      id: string;
      title: string;
      template_id: string | null;
      start_date: string;
      end_date: string;
      status: "active" | "archived";
    }>(
      tx,
      "SELECT * FROM training_plans WHERE user_id=? AND status='active' AND start_date<=? AND end_date>=?",
      [user, plusDays(week, 6), week],
    );
    if (!r) return null;
    const rows = await tx.query<{
      id: string;
      scheduled_date: string;
      course_id: string | null;
      rest_day: 0 | 1;
      sort_order: number;
    }>(
      "SELECT * FROM training_plan_items WHERE plan_id=? AND scheduled_date BETWEEN ? AND ? ORDER BY scheduled_date,sort_order,id",
      [r.id, week, plusDays(week, 6)],
    );
    return {
      id: r.id,
      title: r.title,
      templateId: r.template_id,
      startDate: r.start_date,
      endDate: r.end_date,
      status: r.status,
      items: rows.map((x) => ({
        id: x.id,
        scheduledDate: x.scheduled_date,
        courseId: x.course_id,
        restDay: x.rest_day === 1,
        sortOrder: x.sort_order,
      })),
    };
  }
  async replacePlan(tx: SqlTx, user: string, t: TemplateDto, start: string) {
    await tx.execute(
      "UPDATE training_plans SET status='archived' WHERE user_id=? AND status='active'",
      [user],
    );
    const id = randomUUID();
    const end = plusDays(start, Math.max(...t.days.map((d) => d.dayOffset)));
    await tx.execute(
      "INSERT INTO training_plans (id,user_id,template_id,title,start_date,end_date,status) VALUES (?,?,?,?,?,?,'active')",
      [id, user, t.id, t.title, start, end],
    );
    const items: PlanDto["items"] = [];
    for (const d of t.days) {
      const courses = d.restDay ? [null] : d.courseIds;
      for (const [order, course] of courses.entries()) {
        const item = {
          id: randomUUID(),
          scheduledDate: plusDays(start, d.dayOffset),
          courseId: course,
          restDay: d.restDay,
          sortOrder: order,
        };
        items.push(item);
        await tx.execute(
          "INSERT INTO training_plan_items (id,plan_id,scheduled_date,course_id,rest_day,sort_order) VALUES (?,?,?,?,?,?)",
          [item.id, id, item.scheduledDate, course, item.restDay, order],
        );
      }
    }
    return {
      id,
      title: t.title,
      templateId: t.id,
      startDate: start,
      endDate: end,
      status: "active" as const,
      items,
    };
  }
  reminder(tx: SqlTx, user: string, lock = false) {
    return first<ReminderRow>(
      tx,
      `SELECT * FROM training_reminders WHERE user_id=?${lock ? " FOR UPDATE" : ""}`,
      [user],
    );
  }
  async saveReminder(tx: SqlTx, r: ReminderRow, expected: number) {
    const values = [
      r.enabled,
      r.local_time,
      r.timezone,
      JSON.stringify(r.weekdays),
      JSON.stringify(r.channels),
      r.skip_if_completed,
      r.next_trigger_at ? sqlTime(r.next_trigger_at) : null,
      r.version,
    ] as const;
    if (expected === 0) {
      await tx.execute(
        "INSERT INTO training_reminders (id,user_id,enabled,local_time,timezone,weekdays,channels,skip_if_completed,next_trigger_at,version) VALUES (?,?,?,?,?,?,?,?,?,?)",
        [r.id, r.user_id, ...values],
      );
      return;
    }
    const changed = await tx.execute(
      "UPDATE training_reminders SET enabled=?,local_time=?,timezone=?,weekdays=?,channels=?,skip_if_completed=?,next_trigger_at=?,version=? WHERE id=? AND user_id=? AND version=?",
      [...values, r.id, r.user_id, expected],
    );
    if (changed.affectedRows !== 1)
      fail(409, "VERSION_CONFLICT", "提醒设置已更新");
  }
  due(tx: SqlTx, now: string, limit: number) {
    return tx.query<ReminderRow>(
      "SELECT * FROM training_reminders WHERE enabled=1 AND next_trigger_at<=? ORDER BY next_trigger_at,id LIMIT ?",
      [sqlTime(now), integer(limit, 1, 100)],
    );
  }
  async hasEffectiveWorkout(tx: SqlTx, user: string, day: string) {
    return !!(await first(
      tx,
      "SELECT id FROM workout_sessions WHERE user_id=? AND business_date=? AND status='completed' AND reward_eligible=1 LIMIT 1",
      [user, day],
    ));
  }
  async days(tx: SqlTx, user: string, start: string, end: string) {
    const rows = await tx.query<{
      date: string;
      completedWorkouts: number;
      exerciseKcal: number | string;
      durationSeconds: number | string;
    }>(
      "SELECT business_date AS date,COUNT(*) AS completedWorkouts,SUM(estimated_calories_kcal) AS exerciseKcal,SUM(active_duration_seconds) AS durationSeconds FROM workout_sessions WHERE user_id=? AND status='completed' AND business_date BETWEEN ? AND ? GROUP BY business_date ORDER BY business_date",
      [user, start, end],
    );
    return rows.map((x) => ({
      ...x,
      completedWorkouts: Number(x.completedWorkouts),
      exerciseKcal: Number(x.exerciseKcal),
      durationSeconds: Number(x.durationSeconds),
    }));
  }
  async recommended(tx: SqlTx, user: string, day: string) {
    return (
      (await first<CourseRow>(
        tx,
        "SELECT c.* FROM training_courses c JOIN training_plan_items i ON i.course_id=c.id JOIN training_plans p ON p.id=i.plan_id WHERE p.user_id=? AND p.status='active' AND i.scheduled_date=? AND c.status='published' ORDER BY i.sort_order,c.id LIMIT 1",
        [user, day],
      )) ??
      (await first<CourseRow>(
        tx,
        "SELECT * FROM training_courses WHERE status='published' ORDER BY created_at DESC,id DESC LIMIT 1",
        [],
      ))
    );
  }
  async saveCourse(tx: SqlTx, r: CourseRow, expected: number | null) {
    const args = [
      r.title,
      r.category,
      r.level,
      r.description,
      r.cover_asset_id,
      r.video_asset_id,
      r.estimated_duration_seconds,
      Number(r.estimated_calories_kcal),
      r.status,
      r.version,
    ];
    if (expected === null) {
      await tx.execute(
        "INSERT INTO training_courses (id,title,category,level,description,cover_asset_id,video_asset_id,estimated_duration_seconds,estimated_calories_kcal,status,version) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        [r.id, ...args],
      );
      return;
    }
    const changed = await tx.execute(
      "UPDATE training_courses SET title=?,category=?,level=?,description=?,cover_asset_id=?,video_asset_id=?,estimated_duration_seconds=?,estimated_calories_kcal=?,status=?,version=? WHERE id=? AND version=?",
      [...args, r.id, expected],
    );
    if (changed.affectedRows !== 1)
      fail(409, "VERSION_CONFLICT", "课程版本已更新");
  }
}
