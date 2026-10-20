"use client";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Bell,
  CalendarDays,
  Check,
  Clock,
  Dumbbell,
  Flame,
  Play,
  Pause,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
} from "lucide-react";
import { Dialog } from "@/components/dialog";
import type {
  TrainingApi,
  CourseDto,
  WorkoutSessionDto,
  TrainingReminderInput,
  TrainingReminderDto,
  PlanDto,
  TemplateDto,
  CompletionDto,
} from "./api";
import { createPreviewApi } from "./preview";
import styles from "./training.module.css";
const ApiContext = createContext<TrainingApi | null>(null);
export function TrainingApiProvider({
  api,
  children,
}: {
  api: TrainingApi;
  children: ReactNode;
}) {
  return <ApiContext.Provider value={api}>{children}</ApiContext.Provider>;
}
const preview = process.env.NEXT_PUBLIC_M04_PREVIEW === "true";
const previewApi = preview ? createPreviewApi() : null;
const addDays = (d: string, n: number) =>
  new Date(Date.parse(d + "T00:00:00Z") + n * 86400000)
    .toISOString()
    .slice(0, 10);
export const shanghaiToday = () =>
  new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
export const monday = (d: string) =>
  addDays(d, -((new Date(d + "T00:00:00Z").getUTCDay() + 6) % 7));
const categories: Record<string, string> = {
  stretch: "拉伸",
  strength: "力量",
  cardio: "有氧",
};
const levels: Record<string, string> = {
  beginner: "轻松入门",
  intermediate: "进阶挑战",
};
const emptyReminder = (): TrainingReminderInput => ({
  enabled: false,
  localTime: "19:00",
  timezone: "Asia/Shanghai",
  weekdays: [1, 2, 3, 4, 5],
  channels: ["in_app"],
  skipIfCompleted: true,
  version: 0,
});
const timer = (n: number) =>
  `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
const errorText = (e: unknown) =>
  e instanceof Error ? e.message : "服务暂不可用，请重试";
export function Training({ api: provided }: { api?: TrainingApi } = {}) {
  const contextApi = useContext(ApiContext),
    api = provided ?? contextApi ?? previewApi;
  const [today, setToday] = useState(shanghaiToday),
    [week, setWeek] = useState(() => monday(shanghaiToday()));
  const [courses, setCourses] = useState<CourseDto[]>([]),
    [templates, setTemplates] = useState<TemplateDto[]>([]),
    [templateCursor, setTemplateCursor] = useState<string | null>(null),
    [cursor, setCursor] = useState<string | null>(null);
  const [category, setCategory] = useState(""),
    [level, setLevel] = useState(""),
    [keyword, setKeyword] = useState(""),
    [search, setSearch] = useState("");
  const [plan, setPlan] = useState<PlanDto | null>(null),
    [history, setHistory] = useState<WorkoutSessionDto[]>([]),
    [historyCursor, setHistoryCursor] = useState<string | null>(null),
    [session, setSession] = useState<WorkoutSessionDto | null>(null);
  const [reminder, setReminder] = useState<TrainingReminderDto | null>(null),
    [reminderReady, setReminderReady] = useState(false),
    [draft, setDraft] = useState(emptyReminder);
  const [detail, setDetail] = useState<CourseDto | null>(null),
    [sessionOpen, setSessionOpen] = useState(false),
    [reminderOpen, setReminderOpen] = useState(false),
    [planOpen, setPlanOpen] = useState(false);
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [catalogBusy, setCatalogBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [syncWarning, setSyncWarning] = useState("");
  const [online, setOnline] = useState(true),
    [seconds, setSeconds] = useState(0),
    [result, setResult] = useState<CompletionDto | null>(null);
  const clock = useRef({ base: 0, at: 0 }),
    pending = useRef(false),
    keys = useRef(new Map<string, string>()),
    catalogSequence = useRef(0),
    planSequence = useRef(0),
    refreshSequence = useRef(0);
  function accept(s: WorkoutSessionDto | null) {
    setSession(s);
    clock.current = {
      base: s?.activeDurationSeconds ?? 0,
      at: performance.now(),
    };
    setSeconds(s?.activeDurationSeconds ?? 0);
  }
  async function refresh() {
    if (!api) {
      setLoading(false);
      return;
    }
    const seq = ++refreshSequence.current;
    const values = await Promise.allSettled([
      api.current(),
      api.reminder(),
      api.history(today, today),
      api.templates(),
    ]);
    if (seq !== refreshSequence.current) return;
    let failures = 0;
    if (values[0].status === "fulfilled") accept(values[0].value.session);
    else failures++;
    if (values[1].status === "fulfilled") {
      setReminder(values[1].value);
      setReminderReady(true);
      if (reminderOpen) {
        const r = values[1].value;
        if (r && r.version !== draft.version)
          setDraft({
            enabled: r.enabled,
            localTime: r.localTime,
            timezone: r.timezone,
            weekdays: r.weekdays,
            channels: r.channels,
            skipIfCompleted: r.skipIfCompleted,
            version: r.version,
          });
      }
    } else {
      setReminderReady(false);
      failures++;
    }
    if (values[2].status === "fulfilled") {
      setHistory(values[2].value.items);
      setHistoryCursor(values[2].value.nextCursor);
    } else failures++;
    if (values[3].status === "fulfilled") {
      setTemplates(values[3].value.items);
      setTemplateCursor(values[3].value.nextCursor);
    } else failures++;
    setSyncWarning(
      failures
        ? "部分数据同步失败，展示的上次结果可能已变化，请重新同步。"
        : "",
    );
    if (failures)
      setError(
        values
          .filter((x) => x.status === "rejected")
          .map((x) => errorText((x as PromiseRejectedResult).reason))
          .join("；"),
      );
    setLoading(false);
  }
  useEffect(() => {
    void refresh();
    const on = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine && !pending.current) void refresh();
    };
    const visibility = () => {
      if (document.visibilityState === "visible") {
        setToday(shanghaiToday());
        if (!pending.current) void refresh();
      }
    };
    on();
    window.addEventListener("online", on);
    window.addEventListener("offline", on);
    document.addEventListener("visibilitychange", visibility);
    const tick = setInterval(() => {
      setToday(shanghaiToday());
    }, 30000);
    return () => {
      refreshSequence.current++;
      window.removeEventListener("online", on);
      window.removeEventListener("offline", on);
      document.removeEventListener("visibilitychange", visibility);
      clearInterval(tick);
    };
  }, [api, today]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!api) return;
    const seq = ++catalogSequence.current;
    setCatalogBusy(true);
    api
      .courses({ category, level, keyword: search })
      .then((p) => {
        if (seq === catalogSequence.current) {
          setCourses(p.items);
          setCursor(p.nextCursor);
        }
      })
      .catch((e) => {
        if (seq === catalogSequence.current) {
          setCourses([]);
          setCursor(null);
          setError(errorText(e));
        }
      })
      .finally(() => {
        if (seq === catalogSequence.current) setCatalogBusy(false);
      });
    return () => {
      catalogSequence.current++;
    };
  }, [api, category, level, search]);
  useEffect(() => {
    if (!api) return;
    const seq = ++planSequence.current;
    setPlan(null);
    api
      .plan(week)
      .then((p) => {
        if (seq === planSequence.current) setPlan(p.plan);
      })
      .catch((e) => {
        if (seq === planSequence.current) setError(errorText(e));
      });
    return () => {
      planSequence.current++;
    };
  }, [api, week]);
  useEffect(() => {
    if (!session) return;
    const t = setInterval(
      () =>
        setSeconds(
          clock.current.base +
            (session.status === "active"
              ? Math.max(
                  0,
                  Math.floor((performance.now() - clock.current.at) / 1000),
                )
              : 0),
        ),
      250,
    );
    return () => clearInterval(t);
  }, [session]);
  async function act(
    name: string,
    body: unknown,
    fn: (key: string) => Promise<void>,
  ) {
    if (!api || pending.current || !online) return;
    refreshSequence.current++;
    pending.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    const signature = name + JSON.stringify(body),
      key = keys.current.get(signature) ?? crypto.randomUUID();
    keys.current.set(signature, key);
    try {
      await fn(key);
      keys.current.delete(signature);
    } catch (e) {
      setError(errorText(e));
      const status = (e as { status?: number }).status;
      if (
        status &&
        status >= 400 &&
        status < 500 &&
        status !== 408 &&
        status !== 429 &&
        (e as { code?: string }).code !== "REQUEST_IN_PROGRESS"
      )
        keys.current.delete(signature);
      // Any ambiguous mutation outcome is reconciled from the server; never declare completion locally.
      await refresh();
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  const feedback = error ? (
    <p className={styles.error} role="alert">
      {error}
    </p>
  ) : null;
  const disabled = busy || loading || !api || !online;
  const completed = history.filter((s) => s.status === "completed"),
    currentActive = !!session && ["active", "paused"].includes(session.status);
  const cap = reminder?.deliveryCapability ?? {
    webPush: false,
    appPush: false,
  };
  return (
    <>
      {preview && (
        <p className={styles.preview} role="status">
          交互预览 · 使用内存模拟数据，刷新后重置 ·
          未连接登录、MySQL、积分或推送
        </p>
      )}
      <section className="page-heading">
        <div>
          <p className="greeting">
            <Dumbbell size={15} />
            让运动，成为生活里轻松的习惯
          </p>
          <h1>今天，给身体一点活力。</h1>
          <p className="muted">按计划动一动，也给恢复留出时间。</p>
        </div>
        <button
          className="outline-button"
          disabled={disabled || !reminderReady}
          onClick={() => {
            setDraft(
              reminder
                ? {
                    enabled: reminder.enabled,
                    localTime: reminder.localTime,
                    timezone: reminder.timezone,
                    weekdays: [...reminder.weekdays],
                    channels: [...reminder.channels],
                    skipIfCompleted: reminder.skipIfCompleted,
                    version: reminder.version,
                  }
                : emptyReminder(),
            );
            setReminderOpen(true);
          }}
          aria-label="训练提醒设置"
        >
          <Bell size={16} />
          <span className="desktop-only">训练提醒</span>
        </button>
      </section>
      {!api && (
        <div className={styles.notice} role="status">
          <strong>训练服务待接入</strong>
          <p>
            页面已准备好。接入团队统一登录和训练 API
            后，即可读取你的计划、恢复训练和保存提醒。
          </p>
        </div>
      )}
      {!online && (
        <div className={styles.notice} role="alert">
          当前离线。计时仅为展示，训练状态尚未与服务端同步；恢复网络后将重新核对。
        </div>
      )}
      {error && (
        <div className={styles.error} role="alert">
          {error}
          <button
            className="outline-button"
            disabled={busy || !api || !online}
            onClick={() => {
              setError("");
              void refresh();
            }}
          >
            重新同步
          </button>
        </div>
      )}
      {syncWarning && <p className={styles.notice}>{syncWarning}</p>}
      {message && (
        <p className={styles.success} role="status">
          {message}
        </p>
      )}
      <section className="feature-banner">
        <div>
          <span className="tag white">MY TRAINING · 我的运动计划</span>
          <h2>
            {currentActive ? "继续你的运动节奏" : "动一小会儿，"}
            <br />
            {currentActive ? "每一段努力都被记录" : "收获满满好状态。"}
          </h2>
          <p>
            {currentActive
              ? `已有${session?.status === "paused" ? "暂停中" : "进行中"}训练 · ${timer(seconds)} 有效计时`
              : "选择喜欢的课程，或先为这周安排一个计划。"}
          </p>
          <button
            className="primary-button"
            disabled={disabled}
            onClick={() =>
              currentActive ? setSessionOpen(true) : setPlanOpen(true)
            }
          >
            <Play size={16} />
            {currentActive ? "恢复训练" : "选择训练计划"}
          </button>
        </div>
        <span className="banner-icon" aria-hidden="true">
          🧘🏻‍♀️
        </span>
      </section>
      <div className="two-column">
        <section className="card">
          <div className="section-head">
            <h2>
              <CalendarDays size={17} />
              这周的运动节奏
            </h2>
            <button
              className="outline-button"
              disabled={disabled}
              onClick={() => setPlanOpen(true)}
            >
              更换计划
            </button>
          </div>
          <div className={styles.weekNav}>
            <button
              className="icon-button"
              aria-label="上一周"
              disabled={busy}
              onClick={() => setWeek(addDays(week, -7))}
            >
              <ChevronLeft size={18} />
            </button>
            <span>
              {week} — {addDays(week, 6)}
            </span>
            <button
              className="icon-button"
              aria-label="下一周"
              disabled={busy}
              onClick={() => setWeek(addDays(week, 7))}
            >
              <ChevronRight size={18} />
            </button>
          </div>
          <div className="week-strip">
            {["一", "二", "三", "四", "五", "六", "日"].map((d, i) => {
              const day = addDays(week, i),
                items =
                  plan?.items.filter((x) => x.scheduledDate === day) ?? [];
              return (
                <div key={d} className={styles.day} data-today={day === today}>
                  <small>周{d}</small>
                  <strong>{day.slice(8)}</strong>
                  <small>
                    {!items.length
                      ? "未安排"
                      : items.every((x) => x.restDay)
                        ? "休息日"
                        : `${items.filter((x) => !x.restDay).length}节课程`}
                  </small>
                  {items
                    .filter((x) => x.courseId)
                    .map((x) => (
                      <button
                        key={x.id}
                        disabled={disabled}
                        className={styles.dayCourse}
                        onClick={() =>
                          void act("detail", x.courseId, async () => {
                            setDetail(await api!.course(x.courseId!));
                          })
                        }
                      >
                        查看
                      </button>
                    ))}
                </div>
              );
            })}
          </div>
          <p className="muted tiny">
            {plan
              ? plan.title
              : "本周尚无训练计划。选择模板后会生成包含休息日的日程。"}
          </p>
        </section>
        <section className="card">
          <div className="section-head">
            <h2>
              <Flame size={17} />
              今天的努力
            </h2>
            <span className="tag mint">{today} · 上海时间</span>
          </div>
          <div className="metric-number">
            <strong>
              {completed
                .reduce((n, x) => n + x.estimatedCaloriesKcal, 0)
                .toFixed(1)}
            </strong>
            <span>千卡</span>
            <small>
              {completed.length}
              {historyCursor ? "＋" : ""} 次训练
            </small>
          </div>
          <p className="subsection-note">
            {historyCursor
              ? "仅统计当前已加载记录，请加载更多查看完整成果。"
              : "消耗为课程估算。保存成果与奖励资格分别结算。"}
          </p>
          <p className="muted tiny">
            {reminder?.enabled
              ? `下次提醒：${reminder.nextTriggerAt ? new Date(reminder.nextTriggerAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "待调度"}`
              : "尚未开启训练提醒"}
          </p>
        </section>
      </div>
      <section className="section-space">
        <div className="section-title">
          <div>
            <h2>找到你喜欢的运动</h2>
            <p>TRAINING LIBRARY · 适合自己，才能轻松坚持</p>
          </div>
        </div>
        <form
          className={styles.search}
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(keyword.trim());
          }}
        >
          <input
            aria-label="搜索课程"
            disabled={busy}
            placeholder="搜索课程名称"
            maxLength={100}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <select
            aria-label="课程难度"
            disabled={busy}
            value={level}
            onChange={(e) => setLevel(e.target.value)}
          >
            <option value="">全部难度</option>
            {Object.entries(levels).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
          <button className="outline-button" disabled={busy}>
            搜索
          </button>
        </form>
        <div className="tabs">
          {[["", "全部"], ...Object.entries(categories)].map(([id, label]) => (
            <button
              key={id}
              className={category === id ? "active" : ""}
              aria-pressed={category === id}
              disabled={busy}
              onClick={() => setCategory(id)}
            >
              {label}
            </button>
          ))}
        </div>
        {catalogBusy ? (
          <p className={styles.empty}>正在读取课程…</p>
        ) : !courses.length ? (
          <p className={styles.empty}>
            {api
              ? "没有符合条件的课程，试试其他分类或关键词。"
              : "接入训练服务后显示已发布课程。"}
          </p>
        ) : (
          <div className="workout-grid">
            {courses.map((c) => (
              <article className="card workout-card" key={c.id}>
                <div
                  className={
                    "workout-art " +
                    (c.category === "strength"
                      ? "peach"
                      : c.category === "cardio"
                        ? "mint"
                        : "lilac")
                  }
                >
                  {c.coverUrl ? (
                    <img className={styles.cover} src={c.coverUrl} alt="" />
                  ) : (
                    <span aria-hidden="true">
                      {c.category === "strength"
                        ? "🏋️"
                        : c.category === "cardio"
                          ? "🏃"
                          : "🧘"}
                    </span>
                  )}
                  <span className="tag">{levels[c.level]}</span>
                </div>
                <div className="workout-content">
                  <h3>{c.title}</h3>
                  <p>
                    {Math.ceil(c.estimatedDurationSeconds / 60)} 分钟 · 预计{" "}
                    {c.estimatedCaloriesKcal} 千卡 · {categories[c.category]}
                  </p>
                  <div className="row-actions">
                    <small>{levels[c.level]}</small>
                    <button
                      className="primary-button"
                      disabled={disabled}
                      onClick={() =>
                        void act("detail", c.id, async () => {
                          setDetail(await api!.course(c.id));
                        })
                      }
                    >
                      查看课程 <Play size={12} />
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
        {cursor && (
          <button
            className="outline-button"
            disabled={disabled || catalogBusy}
            onClick={() =>
              void act("courses", cursor, async () => {
                const p = await api!.courses({
                  category,
                  level,
                  keyword: search,
                  cursor,
                });
                setCourses((c) => [...c, ...p.items]);
                setCursor(p.nextCursor);
              })
            }
          >
            加载更多课程
          </button>
        )}
      </section>
      <section className="card section-space">
        <div className="section-head">
          <h2>
            <Clock size={17} />
            今日训练记录
          </h2>
          <button
            className="icon-button"
            aria-label="刷新训练状态"
            disabled={disabled}
            onClick={() => void refresh()}
          >
            <RefreshCw size={17} />
          </button>
        </div>
        {!history.length ? (
          <p className="muted">尚无训练记录，从一节喜欢的课程开始。</p>
        ) : (
          <ul className={styles.records}>
            {history.map((s) => (
              <li key={s.id}>
                <span>
                  {courses.find((c) => c.id === s.courseId)?.title ??
                    "训练记录"}
                  <small>
                    {
                      {
                        active: "进行中",
                        paused: "已暂停",
                        completed: "已完成",
                        abandoned: "已放弃",
                      }[s.status]
                    }{" "}
                    · {timer(s.activeDurationSeconds)}
                  </small>
                </span>
                <span>
                  {s.status === "completed"
                    ? `${s.estimatedCaloriesKcal} 千卡`
                    : "—"}
                  <small>
                    {s.status === "completed"
                      ? s.rewardEligible
                        ? "具备奖励资格"
                        : "已保存 · 未达奖励门槛"
                      : "尚未结算"}
                  </small>
                </span>
              </li>
            ))}
          </ul>
        )}
        {historyCursor && (
          <button
            className="outline-button"
            disabled={disabled}
            onClick={() =>
              void act("history", historyCursor, async () => {
                const p = await api!.history(today, today, historyCursor);
                setHistory((h) => [...h, ...p.items]);
                setHistoryCursor(p.nextCursor);
              })
            }
          >
            加载更多记录
          </button>
        )}
      </section>
      <footer className="page-footer">
        动得开心，比数字更重要。
        <span>训练时间及成果以服务端结算为准 · 按自身情况调整强度</span>
      </footer>
      <Dialog
        open={!!detail}
        onClose={() => {
          if (!busy) setDetail(null);
        }}
        title={detail?.title ?? "课程详情"}
      >
        {feedback}
        {detail && (
          <>
            <p>{detail.description}</p>
            <p className="note-block">
              {levels[detail.level]} ·{" "}
              {Math.ceil(detail.estimatedDurationSeconds / 60)} 分钟 · 预计{" "}
              {detail.estimatedCaloriesKcal} 千卡
            </p>
            {detail.videoUrl ? (
              <video
                controls
                preload="metadata"
                className={styles.video}
                src={detail.videoUrl}
              />
            ) : (
              <p className="muted">
                本课程暂无视频，可按课程说明自主训练计时。
              </p>
            )}
            <button
              className="primary-button"
              disabled={disabled}
              onClick={() => {
                if (currentActive) {
                  setDetail(null);
                  setSessionOpen(true);
                  return;
                }
                void act("start", { courseId: detail.id }, async (key) => {
                  accept(await api!.start(detail.id, key));
                  setDetail(null);
                  setResult(null);
                  setSessionOpen(true);
                });
              }}
            >
              <Play size={16} />
              {currentActive ? "恢复已有训练" : "开始训练"}
            </button>
          </>
        )}
      </Dialog>
      <Dialog
        open={sessionOpen}
        onClose={() => {
          if (!busy) setSessionOpen(false);
        }}
        title="我的训练"
      >
        {feedback}
        {session && (
          <>
            <p>
              {courses.find((c) => c.id === session.courseId)?.title ??
                "当前训练"}
            </p>
            <p className="muted">
              {session.status === "active"
                ? "正在计时"
                : session.status === "paused"
                  ? "已暂停"
                  : "已结束"}{" "}
              · 关闭弹层后仍可恢复
            </p>
            <div className="timer" aria-live="off">
              {timer(seconds)}
            </div>
            <p className="note-block">
              有效活动达到 {timer(session.rewardThresholdSeconds)}{" "}
              后具备奖励资格。未达门槛也可保存训练；实际积分以结算结果为准。
            </p>
            {currentActive && (
              <div className={styles.actions}>
                <button
                  className="outline-button"
                  disabled={disabled}
                  onClick={() =>
                    void act(
                      "update",
                      { id: session.id, version: session.version },
                      async () =>
                        accept(
                          await api!.update(
                            session.id,
                            session.status === "active" ? "pause" : "resume",
                            session.version,
                          ),
                        ),
                    )
                  }
                >
                  {session.status === "active" ? (
                    <Pause size={15} />
                  ) : (
                    <Play size={15} />
                  )}{" "}
                  {session.status === "active" ? "暂停" : "继续训练"}
                </button>
                <button
                  className="primary-button"
                  disabled={disabled}
                  onClick={() =>
                    void act(
                      "complete",
                      { id: session.id, version: session.version },
                      async (key) => {
                        const r = await api!.complete(
                          session.id,
                          session.version,
                          key,
                        );
                        accept(r.session);
                        setResult(r);
                        setMessage("训练成果已保存");
                        if (r.session.businessDate)
                          await api!.invalidateHealth(r.session.businessDate);
                        await refresh();
                      },
                    )
                  }
                >
                  <Check size={15} />
                  完成并保存
                </button>
                <button
                  className="outline-button"
                  disabled={disabled}
                  onClick={() =>
                    void act(
                      "abandon",
                      { id: session.id, version: session.version },
                      async () => {
                        await api!.update(
                          session.id,
                          "abandon",
                          session.version,
                        );
                        accept(null);
                        setSessionOpen(false);
                        setMessage("本次训练已放弃");
                        await refresh();
                      },
                    )
                  }
                >
                  放弃训练
                </button>
              </div>
            )}
            <p className="muted tiny">
              计时仅用于展示，断网期间不会确认保存。结算以服务端收到操作的时间为准。
            </p>
          </>
        )}
        {result && (
          <div className={styles.success}>
            <strong>训练成果已保存</strong>
            <p>
              {timer(result.session.activeDurationSeconds)} ·{" "}
              {result.session.estimatedCaloriesKcal} 千卡
            </p>
            <p>
              {!result.session.rewardEligible
                ? "本次未达奖励门槛，没有积分。"
                : result.awards.length
                  ? `本次获得 ${result.awards.reduce((n, a) => n + a.points, 0)} 积分`
                  : "本次具备奖励资格，未获得新的积分；同日同课程奖励不重复领取。"}
            </p>
          </div>
        )}
        {!session && !result && <p>当前没有进行中的训练。</p>}
      </Dialog>
      <Dialog
        open={planOpen}
        onClose={() => {
          if (!busy) setPlanOpen(false);
        }}
        title="选择训练计划"
      >
        {feedback}
        <p className="muted">
          从 {week} 开始。更换后旧计划归档，新计划包含明确的训练日和休息日。
        </p>
        {templates.length ? (
          templates.map((t) => (
            <article key={t.id} className={styles.template}>
              <div>
                <h3>{t.title}</h3>
                <p>{t.description}</p>
                <small>
                  {t.days.length} 天 · {t.days.filter((d) => d.restDay).length}{" "}
                  天休息
                </small>
              </div>
              <button
                className="primary-button"
                disabled={disabled}
                onClick={() =>
                  void act(
                    "plan",
                    { templateId: t.id, startDate: week },
                    async (key) => {
                      await api!.createPlan(t.id, week, key);
                      setPlan((await api!.plan(week)).plan);
                      setPlanOpen(false);
                      setMessage("训练计划已更新");
                      await api!.invalidateHealth(today);
                    },
                  )
                }
              >
                使用计划
              </button>
            </article>
          ))
        ) : (
          <p className={styles.empty}>暂无已发布的计划模板。</p>
        )}
        {templateCursor && (
          <button
            className="outline-button"
            disabled={disabled}
            onClick={() =>
              void act("templates", templateCursor, async () => {
                const p = await api!.templates(templateCursor);
                setTemplates((t) => [...t, ...p.items]);
                setTemplateCursor(p.nextCursor);
              })
            }
          >
            更多模板
          </button>
        )}
      </Dialog>
      <Dialog
        open={reminderOpen}
        onClose={() => {
          if (!busy) setReminderOpen(false);
        }}
        title="训练提醒"
      >
        {feedback}
        <form
          className={styles.reminderForm}
          onSubmit={(e) => {
            e.preventDefault();
            void act("reminder", draft, async () => {
              const r = await api!.saveReminder(draft);
              setReminder(r);
              setReminderOpen(false);
              setMessage(
                r.enabled
                  ? "提醒设置已保存，送达情况取决于通知通道。"
                  : "训练提醒已关闭",
              );
            });
          }}
        >
          <p className="muted">给自己一个温柔的提醒，把时间留给身体。</p>
          <label className={styles.check}>
            <input
              type="checkbox"
              disabled={busy}
              checked={draft.enabled}
              onChange={(e) =>
                setDraft({ ...draft, enabled: e.target.checked })
              }
            />
            开启训练提醒
          </label>
          <label>
            提醒时间（上海）
            <input
              required
              type="time"
              disabled={busy}
              value={draft.localTime}
              onChange={(e) =>
                setDraft({ ...draft, localTime: e.target.value })
              }
            />
          </label>
          <fieldset className={styles.fieldset}>
            <legend>重复星期</legend>
            <div className={styles.weekdays}>
              {["一", "二", "三", "四", "五", "六", "日"].map((d, i) => (
                <label key={d}>
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={draft.weekdays.includes(i + 1)}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        weekdays: e.target.checked
                          ? [...draft.weekdays, i + 1].sort()
                          : draft.weekdays.filter((x) => x !== i + 1),
                      })
                    }
                  />
                  周{d}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className={styles.fieldset}>
            <legend>提醒通道</legend>
            {(
              [
                ["in_app", "站内提醒", true],
                ["web_push", "浏览器推送", cap.webPush],
                ["app_push", "App 推送", cap.appPush],
              ] as const
            ).map(([id, label, supported]) => (
              <label className={styles.check} key={id}>
                <input
                  type="checkbox"
                  disabled={busy || !supported}
                  checked={draft.channels.includes(id)}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      channels: e.target.checked
                        ? [...draft.channels, id]
                        : draft.channels.filter((c) => c !== id),
                    })
                  }
                />
                {label}
                {!supported ? "（暂未接入）" : ""}
              </label>
            ))}
          </fieldset>
          <label className={styles.check}>
            <input
              type="checkbox"
              disabled={busy}
              checked={draft.skipIfCompleted}
              onChange={(e) =>
                setDraft({ ...draft, skipIfCompleted: e.target.checked })
              }
            />
            提醒当日已有效完成训练时跳过
          </label>
          <p className="note-block">
            未达奖励门槛的已完成训练不会触发跳过。保存设置不代表推送已送达。
          </p>
          <button
            className="primary-button"
            disabled={
              disabled ||
              !reminderReady ||
              (draft.enabled &&
                (!draft.weekdays.length || !draft.channels.length))
            }
          >
            保存设置
          </button>
        </form>
      </Dialog>
    </>
  );
}
