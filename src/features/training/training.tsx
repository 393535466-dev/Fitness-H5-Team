"use client";
import {
  Suspense,
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
  BookOpen,
  ArrowRight,
  ArrowLeft,
  Info,
  CheckCircle2,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import {
  addDays,
  monday,
  shanghaiToday,
  readTrainingRoute,
  trainingHref,
  validStartDate,
  type TrainingRoute,
} from "./navigation";
export { monday, shanghaiToday } from "./navigation";
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
export function Training({ api }: { api?: TrainingApi } = {}) {
  return (
    <Suspense fallback={<p role="status">正在读取训练页面…</p>}>
      <TrainingContent api={api} />
    </Suspense>
  );
}
function TrainingContent({ api: provided }: { api?: TrainingApi }) {
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
  const searchParams = useSearchParams();
  const route = readTrainingRoute(searchParams.toString());
  const [todayPlan, setTodayPlan] = useState<PlanDto | null>(null);
  const [detail, setDetail] = useState<CourseDto | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [knownCourses, setKnownCourses] = useState<Record<string, CourseDto>>(
    {},
  );
  const [startDate, setStartDate] = useState(shanghaiToday);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [confirmAbandon, setConfirmAbandon] = useState(false);
  const [recordsDate, setRecordsDate] = useState(shanghaiToday);
  const [records, setRecords] = useState<WorkoutSessionDto[]>([]);
  const [recordsCursor, setRecordsCursor] = useState<string | null>(null);
  const [recordsBusy, setRecordsBusy] = useState(false);
  const [recordsError, setRecordsError] = useState("");
  const [recordsReload, setRecordsReload] = useState(0);
  const [dataReload, setDataReload] = useState(0);
  const recordsSequence = useRef(0);
  const [planReady, setPlanReady] = useState(false);
  const [historyReady, setHistoryReady] = useState(false);
  const [catalogError, setCatalogError] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
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
      api.plan(monday(today)),
    ]);
    if (seq !== refreshSequence.current) return;
    let failures = 0;
    if (values[0].status === "fulfilled") accept(values[0].value.session);
    else failures++;
    if (values[1].status === "fulfilled") {
      setReminder(values[1].value);
      setReminderReady(true);
      if (route.view === "reminder") {
        const r = values[1].value;
        if (r && r.version !== draft.version) {
          setMessage("提醒已在其他位置更新，请核对最新设置。");
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
      }
    } else {
      setReminderReady(false);
      failures++;
    }
    if (values[2].status === "fulfilled") {
      setHistoryReady(true);
      setHistory(values[2].value.items);
      setHistoryCursor(values[2].value.nextCursor);
    } else {
      setHistoryReady(false);
      failures++;
    }
    if (values[3].status === "fulfilled") {
      setTemplates(values[3].value.items);
      setTemplateCursor(values[3].value.nextCursor);
    } else failures++;
    if (values[4].status === "fulfilled") setTodayPlan(values[4].value.plan);
    else failures++;
    setSyncWarning(
      failures
        ? "部分数据同步失败，展示的上次结果可能已变化，请重新同步。"
        : "",
    );
    if (!failures) setError("");
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
    setCatalogError(false);
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
          setCatalogError(true);
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
  }, [api, category, level, search, dataReload]);
  useEffect(() => {
    if (!api) return;
    const seq = ++planSequence.current;
    setPlan(null);
    setPlanReady(false);
    api
      .plan(week)
      .then((p) => {
        if (seq === planSequence.current) {
          setPlan(p.plan);
          setPlanReady(true);
        }
      })
      .catch((e) => {
        if (seq === planSequence.current) setError(errorText(e));
      });
    return () => {
      planSequence.current++;
    };
  }, [api, week, dataReload]);
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
  function go(next: TrainingRoute, replace = false) {
    const href = trainingHref(next);
    if (href === trainingHref(route)) return;
    window.history[replace ? "replaceState" : "pushState"](null, "", href);
    setError("");
    setMessage("");
    setConfirmAbandon(false);
    setConfirmReplace(false);
  }
  useEffect(() => {
    if (route.date) setRecordsDate(route.date);
    setConfirmAbandon(false);
    setConfirmReplace(false);
  }, [route.view, route.id, route.date]);
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
    headingRef.current?.focus({ preventScroll: true });
  }, [route.view, route.id]);
  useEffect(() => {
    if (route.view !== "reminder" || !reminderReady) return;
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
  }, [route.view, reminderReady, reminder?.version]);
  useEffect(() => {
    if (!["course", "learn"].includes(route.view)) return;
    setDetail(null);
    if (!api || !route.id) {
      setDetailBusy(false);
      return;
    }
    let live = true;
    setDetailBusy(true);
    api
      .course(route.id)
      .then((c) => {
        if (live) {
          setDetail(c);
          setKnownCourses((prev) => ({ ...prev, [c.id]: c }));
        }
      })
      .catch((e) => {
        if (live) setError(errorText(e));
      })
      .finally(() => {
        if (live) setDetailBusy(false);
      });
    return () => {
      live = false;
    };
  }, [api, route.view, route.id, dataReload]);
  useEffect(() => {
    if (route.view !== "records" || !api) return;
    let live = true;
    recordsSequence.current++;
    setRecords([]);
    setRecordsCursor(null);
    setRecordsBusy(true);
    setRecordsError("");
    api
      .history(recordsDate, recordsDate)
      .then((p) => {
        if (live) {
          setRecords(p.items);
          setRecordsCursor(p.nextCursor);
        }
      })
      .catch((e) => {
        if (live) setRecordsError(errorText(e));
      })
      .finally(() => {
        if (live) setRecordsBusy(false);
      });
    return () => {
      live = false;
      recordsSequence.current++;
    };
  }, [route.view, recordsDate, recordsReload, api]);
  useEffect(() => {
    if (
      !api ||
      loading ||
      route.view !== "plan" ||
      !route.id ||
      !templateCursor ||
      templates.some((t) => t.id === route.id)
    )
      return;
    let live = true;
    api
      .templates(templateCursor)
      .then((page) => {
        if (!live) return;
        setTemplates((previous) => [
          ...previous,
          ...page.items.filter((t) => !previous.some((p) => p.id === t.id)),
        ]);
        setTemplateCursor(
          page.nextCursor === templateCursor ? null : page.nextCursor,
        );
      })
      .catch((e) => {
        if (live) setError(errorText(e));
      });
    return () => {
      live = false;
    };
  }, [
    api,
    loading,
    route.view,
    route.id,
    templateCursor,
    templates,
    dataReload,
  ]);
  const courseIds = [
    ...new Set([
      ...templates.flatMap((t) => t.days.flatMap((d) => d.courseIds)),
      ...(plan?.items.flatMap((i) => (i.courseId ? [i.courseId] : [])) ?? []),
      ...(todayPlan?.items.flatMap((i) => (i.courseId ? [i.courseId] : [])) ??
        []),
      ...history.map((s) => s.courseId),
      ...records.map((s) => s.courseId),
      ...(session ? [session.courseId] : []),
    ]),
  ]
    .sort()
    .join(",");
  useEffect(() => {
    if (!api) return;
    let live = true;
    const ids = courseIds.split(",").filter((id) => id && !knownCourses[id]);
    if (ids.length)
      void Promise.allSettled(ids.map((id) => api.course(id))).then(
        (results) => {
          if (!live) return;
          const found: Record<string, CourseDto> = {};
          for (const r of results)
            if (r.status === "fulfilled") found[r.value.id] = r.value;
          setKnownCourses((prev) => ({ ...prev, ...found }));
        },
      );
    return () => {
      live = false;
    };
  }, [api, courseIds, dataReload]); // Metadata cache is independent of the catalog's current filters.
  const disabled = busy || loading || !api || !online;
  const completed = history.filter((s) => s.status === "completed");
  const currentActive =
    !!session && ["active", "paused"].includes(session.status);
  const cap = reminder?.deliveryCapability ?? {
    webPush: false,
    appPush: false,
  };
  const reminderDirty =
    reminderReady &&
    (reminder === null ||
      draft.enabled !== reminder.enabled ||
      draft.localTime !== reminder.localTime ||
      draft.skipIfCompleted !== reminder.skipIfCompleted ||
      [...draft.weekdays].sort().join(",") !==
        [...reminder.weekdays].sort().join(",") ||
      [...draft.channels].sort().join(",") !==
        [...reminder.channels].sort().join(","));
  function changeDraft(next: TrainingReminderInput) {
    setDraft(next);
    setMessage("");
  }
  const selectedTemplate = templates.find((t) => t.id === route.id);
  const titleFor = (id: string) =>
    knownCourses[id]?.title ??
    courses.find((c) => c.id === id)?.title ??
    "课程信息暂不可用";
  const dayItems =
    todayPlan?.items.filter((i) => i.scheduledDate === today) ?? [];
  const restToday = dayItems.length > 0 && dayItems.every((i) => i.restDay);
  const plannedCourse = dayItems.find((i) => i.courseId)?.courseId;
  const statusText = {
    active: "进行中",
    paused: "已暂停",
    completed: "已完成",
    abandoned: "已放弃",
  };
  const titles: Record<TrainingRoute["view"], string> = {
    home: "今天，给身体一点活力。",
    plans: "找到适合你的运动节奏",
    plan: "计划预览",
    course: detail?.title ?? "课程详情",
    learn: "课程学习",
    session: "我的训练",
    result: "这一次，也算进步",
    records: "训练记录",
    reminder: "训练提醒",
  };
  function parentRoute(): TrainingRoute {
    if (route.view === "plan") return { view: "plans" };
    if (route.view === "learn")
      return route.from === "session"
        ? { view: "session" }
        : {
            view: "course",
            id: route.id,
            from: route.from,
            templateId: route.templateId,
          };
    if (route.view === "course" && route.from === "plan")
      return { view: "plan", id: route.templateId };
    return { view: "home" };
  }
  function navButton(label: string, next: TrainingRoute, primary = false) {
    return (
      <button
        className={primary ? "primary-button" : "outline-button"}
        disabled={busy}
        onClick={() => go(next)}
      >
        {label}
        <ArrowRight size={15} />
      </button>
    );
  }
  function beginCourse() {
    if (!detail) return;
    if (currentActive) {
      go({ view: "session" });
      return;
    }
    void act("start", { courseId: detail.id }, async (key) => {
      accept(await api!.start(detail.id, key));
      setResult(null);
      go({ view: "session" });
    });
  }
  function useTemplate() {
    if (!selectedTemplate || !validStartDate(startDate) || !planReady) return;
    void act(
      "plan",
      { templateId: selectedTemplate.id, startDate },
      async (key) => {
        const saved = await api!.createPlan(
          selectedTemplate.id,
          startDate,
          key,
        );
        const nextWeek = monday(startDate);
        setWeek(nextWeek);
        setPlan(saved);
        go({ view: "home" });
        setMessage("训练计划已保存。可以查看日程，也可以设置训练提醒。");
        await refresh();
        try {
          await api!.invalidateHealth(today);
        } catch {
          setSyncWarning("训练计划已保存，健康看板暂未同步，请稍后刷新看板。");
        }
      },
    );
  }
  function recordList(items: WorkoutSessionDto[]) {
    return (
      <ul className={styles.records}>
        {items.map((s) => (
          <li key={s.id}>
            <span>
              <strong>{titleFor(s.courseId)}</strong>
              <small>
                {statusText[s.status]} · {timer(s.activeDurationSeconds)}{" "}
                活动时间
              </small>
            </span>
            <span>
              {s.status === "completed"
                ? `${s.estimatedCaloriesKcal} 千卡（估算）`
                : "尚未结算"}
              <small>
                {s.status === "completed"
                  ? s.rewardEligible
                    ? "具备奖励资格 · 实际积分以结算为准"
                    : "成果已保存 · 未达奖励门槛"
                  : "不计入已完成成果"}
              </small>
              {["active", "paused"].includes(s.status) &&
                currentActive &&
                session?.id === s.id && (
                  <button
                    className={styles.textButton}
                    disabled={disabled}
                    onClick={() => go({ view: "session" })}
                  >
                    返回训练
                  </button>
                )}
            </span>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div className={styles.module}>
      {preview && (
        <p className={styles.preview} role="status">
          交互预览 · 使用内存模拟数据，刷新后重置 ·
          未连接登录、MySQL、积分或推送
        </p>
      )}
      {route.view !== "home" && (
        <header className={styles.subHeader}>
          <button
            className={styles.back}
            disabled={busy}
            onClick={() => go(parentRoute())}
          >
            <ArrowLeft size={17} />
            {route.view === "learn"
              ? route.from === "session"
                ? "返回当前训练"
                : "返回课程详情"
              : route.view === "course" && route.from === "plan"
                ? "返回计划预览"
                : route.view === "plan"
                  ? "返回计划列表"
                  : "返回运动首页"}
          </button>
          <p className={styles.eyebrow}>
            MY TRAINING / {route.view.toUpperCase()}
          </p>
          <h1 ref={headingRef} tabIndex={-1}>
            {titles[route.view]}
          </h1>
        </header>
      )}
      {!api && (
        <div className={styles.notice} role="status">
          <strong>训练服务待接入</strong>
          <p>接入团队统一训练服务后，可读取你的计划、训练记录和提醒设置。</p>
        </div>
      )}
      {!online && (
        <p className={styles.notice} role="alert">
          当前离线。页面计时仅供参考；恢复网络后将核对训练状态，保存结果以同步成功为准。
        </p>
      )}
      {error && (
        <div className={styles.error} role="alert">
          {error}
          <button
            className="outline-button"
            disabled={busy || !api || !online}
            onClick={() => {
              setError("");
              setDataReload((n) => n + 1);
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

      {route.view === "home" && (
        <>
          <section className="page-heading">
            <div>
              <p className="greeting">
                <Dumbbell size={15} />
                让运动，成为生活里轻松的习惯
              </p>
              <h1 ref={headingRef} tabIndex={-1}>
                {titles.home}
              </h1>
              <p className="muted">知道今天练什么，也给恢复留出时间。</p>
            </div>
            <button
              className="outline-button"
              disabled={disabled || !reminderReady}
              onClick={() => go({ view: "reminder" })}
              aria-label="训练提醒设置"
            >
              <Bell size={16} />
              <span>训练提醒</span>
            </button>
          </section>
          <section className={styles.todayHero}>
            <div>
              <p className={styles.eyebrow}>TODAY’S FOCUS · {today}</p>
              <h2>
                {currentActive
                  ? "接着上次，继续就好"
                  : restToday
                    ? "今天，给身体一点恢复时间"
                    : plannedCourse
                      ? titleFor(plannedCourse)
                      : "从一节喜欢的课程开始"}
              </h2>
              <p>
                {currentActive
                  ? `${titleFor(session!.courseId)} · ${session!.status === "paused" ? "已暂停" : "正在计时"} ${timer(seconds)}`
                  : restToday
                    ? "休息也是计划的一部分。想活动一下，也可以自主选择课程。"
                    : plannedCourse
                      ? "今天的课程已安排好，开始前先看看课程说明。"
                      : "先安排一个可坚持的节奏，也可以先体验单节课程。"}
              </p>
              <div className={styles.actionsLeft}>
                {currentActive
                  ? navButton("返回当前训练", { view: "session" }, true)
                  : plannedCourse
                    ? navButton(
                        "查看今日课程",
                        { view: "course", id: plannedCourse },
                        true,
                      )
                    : navButton("选择训练计划", { view: "plans" }, true)}
                {currentActive || plannedCourse ? (
                  navButton("查看计划", { view: "plans" })
                ) : (
                  <a href="#training-library" className="outline-button">
                    浏览课程
                    <ArrowRight size={15} />
                  </a>
                )}
              </div>
            </div>
            <div className={styles.heroSymbol} aria-hidden="true">
              <Dumbbell size={54} />
              <span>
                ONE STEP
                <br />
                AT A TIME
              </span>
            </div>
          </section>
          <div className={styles.shortcuts}>
            <button onClick={() => go({ view: "plans" })}>
              <CalendarDays />
              <span>
                我的计划<small>安排训练，也安排休息</small>
              </span>
              <ChevronRight size={17} />
            </button>
            <button onClick={() => go({ view: "records", date: today })}>
              <Clock />
              <span>
                训练记录<small>回看每一次实际努力</small>
              </span>
              <ChevronRight size={17} />
            </button>
            <button
              disabled={!reminderReady}
              onClick={() => go({ view: "reminder" })}
            >
              <Bell />
              <span>
                训练提醒
                <small>
                  {!api
                    ? "服务待接入"
                    : !reminderReady
                      ? loading
                        ? "正在读取"
                        : "尚未同步"
                      : reminder === null
                        ? "未设置"
                        : reminder.enabled
                          ? "设置已保存"
                          : "已关闭"}
                </small>
              </span>
              <ChevronRight size={17} />
            </button>
          </div>
          <div className="two-column">
            <section className="card">
              <div className="section-head">
                <h2>
                  <CalendarDays size={17} />
                  这周的运动节奏
                </h2>
                {navButton(plan ? "更换计划" : "选择计划", { view: "plans" })}
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
                    <div
                      key={d}
                      className={styles.day}
                      data-today={day === today}
                    >
                      <small>周{d}</small>
                      <strong>{day.slice(8)}</strong>
                      <small>
                        {!planReady
                          ? loading
                            ? "读取中"
                            : "未同步"
                          : !items.length
                            ? "未安排"
                            : items.every((x) => x.restDay)
                              ? "休息日"
                              : `${items.filter((x) => !x.restDay).length}节课程`}
                      </small>
                      {items
                        .filter((x) => x.courseId)
                        .map((x, n) => (
                          <button
                            key={x.id}
                            disabled={disabled}
                            className={styles.dayCourse}
                            aria-label={`${day} 查看课程 ${n + 1}`}
                            onClick={() =>
                              go({ view: "course", id: x.courseId! })
                            }
                          >
                            查看
                          </button>
                        ))}
                    </div>
                  );
                })}
              </div>
              <p className={styles.subtle}>
                {plan
                  ? plan.title
                  : planReady
                    ? "本周暂无安排。计划可以从你选择的日期开始。"
                    : "计划数据尚未读取完成。"}
              </p>
              <button
                className={styles.textButton}
                disabled={busy}
                onClick={() => setWeek(monday(today))}
              >
                回到本周
              </button>
            </section>
            <section className="card">
              <div className="section-head">
                <h2>
                  <Flame size={17} />
                  今天的努力
                </h2>
                <span className="tag mint">
                  {historyReady ? "已完成" : "待同步"}
                </span>
              </div>
              <div className="metric-number">
                <strong>
                  {historyReady
                    ? completed
                        .reduce((n, x) => n + x.estimatedCaloriesKcal, 0)
                        .toFixed(1)
                    : "—"}
                </strong>
                <span>千卡（估算）</span>
              </div>
              <p className={styles.subtle}>
                {historyReady
                  ? `${completed.length}${historyCursor ? "＋" : ""} 次训练 · 活动 ${Math.floor(completed.reduce((n, x) => n + x.activeDurationSeconds, 0) / 60)} 分钟`
                  : "训练记录尚未同步，暂不显示成果汇总。"}
              </p>
              <p className={styles.subtle}>
                {historyCursor
                  ? "仅汇总已加载的今日记录。"
                  : "记录实际努力，积分另行结算。"}
              </p>
              {navButton("查看记录", { view: "records", date: today })}
            </section>
          </div>
          <section className="section-space" id="training-library">
            <div className="section-title">
              <div>
                <h2>找到你喜欢的运动</h2>
                <p>TRAINING LIBRARY · 先了解，再开始</p>
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
              {[["", "全部"], ...Object.entries(categories)].map(
                ([id, label]) => (
                  <button
                    key={id}
                    className={category === id ? "active" : ""}
                    aria-pressed={category === id}
                    disabled={busy}
                    onClick={() => setCategory(id)}
                  >
                    {label}
                  </button>
                ),
              )}
            </div>
            {catalogBusy ? (
              <p className={styles.empty}>正在读取课程…</p>
            ) : !courses.length ? (
              <div className={styles.empty}>
                <p>
                  {api
                    ? catalogError
                      ? "课程暂时无法读取，请重新同步。"
                      : "没有符合条件的课程，试试其他分类或关键词。"
                    : "接入训练服务后显示已发布课程。"}
                </p>
                {api && (
                  <button
                    className={styles.textButton}
                    onClick={() => {
                      setCategory("");
                      setLevel("");
                      setKeyword("");
                      setSearch("");
                    }}
                  >
                    清除筛选
                  </button>
                )}
              </div>
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
                        {Math.ceil(c.estimatedDurationSeconds / 60)} 分钟 ·{" "}
                        {categories[c.category]} · 预计{" "}
                        {c.estimatedCaloriesKcal} 千卡
                      </p>
                      <div className="row-actions">
                        <small>
                          {c.videoUrl ? "含教学视频" : "文字课程说明"}
                        </small>
                        {navButton(
                          "了解课程",
                          { view: "course", id: c.id },
                          true,
                        )}
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
          <section className={styles.learningEntry}>
            <BookOpen size={24} />
            <div>
              <h2>开始前，先读懂这节课</h2>
              <p>
                课程详情里可以查看文字说明与可用视频，训练中也能随时返回查看。
              </p>
            </div>
            <a href="#training-library" className={styles.textButton}>
              去选一节课 <ArrowRight size={15} />
            </a>
          </section>
          <section className="card section-space">
            <div className="section-head">
              <h2>
                <Clock size={17} />
                今日训练记录
              </h2>
              {navButton("查看记录", { view: "records", date: today })}
            </div>
            {!history.length ? (
              <p className={styles.subtle}>
                {historyReady
                  ? "尚无训练记录，从一节喜欢的课程开始。"
                  : "训练记录尚未同步。"}
              </p>
            ) : (
              recordList(history)
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
                加载更多今日记录
              </button>
            )}
          </section>
        </>
      )}

      {route.view === "plans" && (
        <>
          {plan && (
            <section className={styles.currentPlan}>
              <span className="tag">所查看周的计划</span>
              <h2>{plan.title}</h2>
              <p>
                {plan.startDate} — {plan.endDate}
              </p>
              <p className={styles.subtle}>
                下方选择新模板前，可以先查看完整日程。替换计划将保留已完成的训练记录。
              </p>
            </section>
          )}
          <p className={styles.intro}>
            计划帮你减少每天的选择，也为休息留出位置。选择模板后，先预览内容，再决定从哪天开始。
          </p>
          <div className={styles.planGrid}>
            {templates.map((t) => (
              <article key={t.id} className={styles.planCard}>
                <p className={styles.eyebrow}>TRAINING PROGRAM</p>
                <CalendarDays size={32} />
                <h2>{t.title}</h2>
                <p>{t.description}</p>
                <div className={styles.pills}>
                  <span>{t.days.length} 天日程</span>
                  <span>{t.days.filter((d) => !d.restDay).length} 天训练</span>
                  <span>{t.days.filter((d) => d.restDay).length} 天休息</span>
                </div>
                {navButton("预览计划", { view: "plan", id: t.id }, true)}
              </article>
            ))}
          </div>
          {!templates.length && (
            <p className={styles.empty}>
              {!api
                ? "接入训练服务后显示计划模板。"
                : loading
                  ? "正在读取模板…"
                  : "暂无可用的计划模板。"}
            </p>
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
              加载更多模板
            </button>
          )}
        </>
      )}
      {route.view === "plan" &&
        (selectedTemplate ? (
          <div className={styles.detailGrid}>
            <section className="card">
              <span className="tag lilac">
                {selectedTemplate.days.length} 天日程
              </span>
              <h2 className={styles.detailTitle}>{selectedTemplate.title}</h2>
              <p className={styles.intro}>{selectedTemplate.description}</p>
              <h3>训练与恢复，一起安排</h3>
              <ol className={styles.timeline}>
                {selectedTemplate.days.map((d) => (
                  <li key={d.dayOffset} data-rest={d.restDay}>
                    <span className={styles.dayBadge}>D{d.dayOffset + 1}</span>
                    <div>
                      <small>
                        {validStartDate(startDate)
                          ? addDays(startDate, d.dayOffset)
                          : `第 ${d.dayOffset + 1} 天`}
                      </small>
                      <h3>
                        {d.restDay
                          ? "休息与恢复"
                          : d.courseIds.map(titleFor).join(" / ") ||
                            "课程待确认"}
                      </h3>
                      {d.restDay ? (
                        <p>恢复日，没有安排训练课程。</p>
                      ) : (
                        d.courseIds.map((id) => (
                          <div key={id} className={styles.scheduleCourse}>
                            <span>
                              {knownCourses[id]
                                ? `${Math.ceil(knownCourses[id].estimatedDurationSeconds / 60)} 分钟 · ${levels[knownCourses[id].level]}`
                                : "课程时长暂不可用"}
                            </span>
                            <button
                              className={styles.textButton}
                              disabled={disabled}
                              onClick={() =>
                                go({
                                  view: "course",
                                  id,
                                  from: "plan",
                                  templateId: selectedTemplate.id,
                                })
                              }
                            >
                              查看课程
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </section>
            <aside className={styles.stickyCard}>
              <h2>从哪天开始？</h2>
              <p className={styles.subtle}>
                按你的时间安排，不默认补上过去的训练。
              </p>
              <label>
                计划开始日期
                <input
                  type="date"
                  required
                  value={startDate}
                  disabled={busy}
                  onChange={(e) => {
                    setStartDate(e.target.value);
                    setConfirmReplace(false);
                  }}
                />
              </label>
              <div className={styles.dateShortcuts}>
                <button
                  className={styles.textButton}
                  disabled={busy}
                  onClick={() => {
                    setStartDate(today);
                    setConfirmReplace(false);
                  }}
                >
                  今天
                </button>
                <button
                  className={styles.textButton}
                  disabled={busy}
                  onClick={() => {
                    setStartDate(addDays(today, 1));
                    setConfirmReplace(false);
                  }}
                >
                  明天
                </button>
              </div>
              {validStartDate(startDate) && (
                <p className={styles.subtle}>
                  日程范围：{startDate} —{" "}
                  {addDays(
                    startDate,
                    Math.max(
                      ...selectedTemplate.days.map((d) => d.dayOffset),
                      0,
                    ),
                  )}
                </p>
              )}
              {startDate < today && validStartDate(startDate) && (
                <p className={styles.notice}>
                  你选择了过去的日期。过去的日程只会显示安排，不会补记训练成果。
                </p>
              )}
              <p className={styles.subtle}>
                本计划来自固定模板。是否适合你，请结合课程说明判断。
              </p>
              {confirmReplace ? (
                <div
                  className={styles.confirm}
                  role="group"
                  aria-label="确认更换计划"
                >
                  <h3>{plan ? "替换当前计划？" : "确认使用这个计划？"}</h3>
                  <p>
                    如有正在使用的旧计划，将归档保留。已完成训练记录不受影响。新日程从{" "}
                    {startDate} 开始。
                  </p>
                  <button
                    className="primary-button"
                    disabled={
                      disabled || !validStartDate(startDate) || !planReady
                    }
                    onClick={useTemplate}
                  >
                    {plan ? "确认替换计划" : "确认使用计划"}
                  </button>
                  <button
                    className="outline-button"
                    disabled={busy}
                    onClick={() => setConfirmReplace(false)}
                  >
                    返回预览
                  </button>
                </div>
              ) : (
                <button
                  className="primary-button"
                  disabled={
                    disabled || !validStartDate(startDate) || !planReady
                  }
                  onClick={() => setConfirmReplace(true)}
                >
                  {busy ? "正在保存…" : "使用这个计划"}
                  <ArrowRight size={15} />
                </button>
              )}
              {!planReady && (
                <p className={styles.subtle}>
                  正在核对当前计划，完成后可保存。
                </p>
              )}
            </aside>
          </div>
        ) : (
          <p className={styles.empty}>
            {loading
              ? "正在读取计划…"
              : "未找到该模板；请返回列表选择可用计划。"}
          </p>
        ))}

      {["course", "learn"].includes(route.view) &&
        (detailBusy ? (
          <p className={styles.empty}>正在读取课程…</p>
        ) : detail ? (
          <div className={styles.detailGrid}>
            <section className="card">
              {route.view === "course" ? (
                <>
                  <div
                    className={styles.courseHero}
                    data-category={detail.category}
                  >
                    {detail.coverUrl ? (
                      <img src={detail.coverUrl} alt="" />
                    ) : (
                      <Dumbbell size={66} />
                    )}
                    <span>
                      {categories[detail.category]} / {levels[detail.level]}
                    </span>
                  </div>
                  <div className={styles.pills}>
                    <span>
                      <Clock size={14} />
                      {Math.ceil(detail.estimatedDurationSeconds / 60)} 分钟
                    </span>
                    <span>
                      <Flame size={14} />
                      预计 {detail.estimatedCaloriesKcal} 千卡
                    </span>
                    <span>{detail.videoUrl ? "含教学视频" : "文字说明"}</span>
                  </div>
                  <h2>这节课练什么</h2>
                  <p className={styles.prose}>
                    {detail.description || "课程介绍待补充。"}
                  </p>
                  <div className={styles.learningEntry}>
                    <BookOpen />
                    <div>
                      <h3>先了解课程，再开始</h3>
                      <p>查看说明与可用的教学素材。</p>
                    </div>
                    {navButton("进入学习", {
                      view: "learn",
                      id: detail.id,
                      from: route.from,
                      templateId: route.templateId,
                    })}
                  </div>
                  <h3>开始前了解</h3>
                  <p className={styles.subtle}>
                    预计时长是计划目标。开始后由你主动控制计时，暂停期间不累计活动时间。
                  </p>
                </>
              ) : (
                <>
                  <p className={styles.eyebrow}>LEARN BEFORE YOU MOVE</p>
                  <h2 className={styles.detailTitle}>{detail.title}</h2>
                  <h3>课程说明</h3>
                  <p className={styles.prose}>
                    {detail.description || "课程说明待补充。"}
                  </p>
                  <h3>教学视频</h3>
                  {detail.videoUrl ? (
                    <video
                      controls
                      preload="metadata"
                      className={styles.video}
                      src={detail.videoUrl}
                      onError={() =>
                        setError("教学视频暂时无法加载，可以先阅读文字说明。")
                      }
                    />
                  ) : (
                    <div className={styles.videoEmpty}>
                      <BookOpen size={28} />
                      <strong>本课程暂无教学视频</strong>
                      <p>目前可阅读课程文字说明。</p>
                    </div>
                  )}
                  <div className={styles.materials}>
                    <h3>更多学习内容</h3>
                    <dl>
                      <div>
                        <dt>适用条件与准备清单</dt>
                        <dd>待补充正式课程内容</dd>
                      </div>
                      <div>
                        <dt>动作要点与注意事项</dt>
                        <dd>待补充正式课程内容</dd>
                      </div>
                    </dl>
                    <p>准备清单与动作要点暂未提供。</p>
                  </div>
                </>
              )}
            </section>
            <aside className={styles.stickyCard}>
              <h2>
                {route.view === "learn" ? "学完，回到训练" : "准备好再出发"}
              </h2>
              <p className={styles.subtle}>
                {currentActive
                  ? `${titleFor(session!.courseId)} · ${session!.status === "active" ? "仍在计时" : "已暂停"} ${timer(seconds)}`
                  : "阅读说明与观看视频不会自动开始训练，也不会计为已完成。"}
              </p>
              {currentActive && (
                <p className={styles.notice}>
                  查看学习内容不会自动暂停训练。如需暂停，请先返回训练操作。
                </p>
              )}
              <button
                className="primary-button"
                disabled={disabled}
                onClick={beginCourse}
              >
                <Play size={16} />
                {currentActive ? "返回当前训练" : "开始训练计时"}
              </button>
              {route.view === "learn" &&
                navButton("返回课程详情", {
                  view: "course",
                  id: detail.id,
                  from: route.from === "plan" ? "plan" : undefined,
                  templateId: route.templateId,
                })}
              <p className={styles.subtle}>
                阅读或观看课程不会自动计入训练成果。
              </p>
            </aside>
          </div>
        ) : (
          <div className={styles.empty}>
            <p>课程暂不可用，请返回列表选择其他课程。</p>
            {navButton("返回运动首页", { view: "home" })}
          </div>
        ))}

      {route.view === "session" && (
        <>
          {currentActive ? (
            <div className={styles.detailGrid}>
              <section className={styles.timerCard}>
                <span
                  className={styles.liveStatus}
                  data-paused={session!.status === "paused"}
                >
                  <i />
                  {session!.status === "active" ? "正在计时" : "训练已暂停"}
                </span>
                <h2>{titleFor(session!.courseId)}</h2>
                <div className={styles.timerValue} aria-live="off">
                  {timer(seconds)}
                </div>
                <p>活动时间 · 暂停期间不累计</p>
                <div
                  className={styles.progressTrack}
                  role="progressbar"
                  aria-label="课程目标时长进度"
                  aria-valuenow={Math.min(
                    100,
                    Math.floor(
                      (seconds / session!.durationSnapshotSeconds) * 100,
                    ),
                  )}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <span
                    style={{
                      width: `${Math.min((seconds / session!.durationSnapshotSeconds) * 100, 100)}%`,
                    }}
                  />
                </div>
                <p className={styles.subtle}>
                  课程目标 {timer(session!.durationSnapshotSeconds)} ·
                  记录你的实际训练时间
                </p>
                <div className={styles.actions}>
                  <button
                    className="outline-button"
                    disabled={disabled}
                    onClick={() =>
                      void act(
                        "update",
                        { id: session!.id, version: session!.version },
                        async () =>
                          accept(
                            await api!.update(
                              session!.id,
                              session!.status === "active" ? "pause" : "resume",
                              session!.version,
                            ),
                          ),
                      )
                    }
                  >
                    {session!.status === "active" ? (
                      <Pause size={16} />
                    ) : (
                      <Play size={16} />
                    )}{" "}
                    {session!.status === "active" ? "暂停训练" : "继续训练"}
                  </button>
                  <button
                    className="primary-button"
                    disabled={disabled}
                    onClick={() =>
                      void act(
                        "complete",
                        { id: session!.id, version: session!.version },
                        async (key) => {
                          const r = await api!.complete(
                            session!.id,
                            session!.version,
                            key,
                          );
                          accept(r.session);
                          setResult(r);
                          go({ view: "result" });
                          await refresh();
                          if (r.session.businessDate) {
                            try {
                              await api!.invalidateHealth(
                                r.session.businessDate,
                              );
                            } catch {
                              setSyncWarning(
                                "训练成果已保存，健康看板暂未同步，请稍后刷新看板。",
                              );
                            }
                          }
                        },
                      )
                    }
                  >
                    <Check size={16} />
                    完成并保存
                  </button>
                </div>
                <p className={styles.subtle}>
                  离开此页不会自动暂停。需要休息时，请先点击暂停。
                </p>
              </section>
              <aside className={styles.stickyCard}>
                <h2>
                  <BookOpen size={18} />
                  随时回看课程
                </h2>
                <p className={styles.subtle}>
                  不确定课程说明时，可以查看后回到同一训练。
                </p>
                {navButton("查看课程说明", {
                  view: "learn",
                  id: session!.courseId,
                  from: "session",
                })}
                <details className={styles.ruleDetails}>
                  <summary>训练记录与奖励规则</summary>
                  <p>
                    活动达到 {timer(session!.rewardThresholdSeconds)}{" "}
                    后具备奖励资格。未达门槛也能保存成果；具备资格不代表重复领取积分。
                  </p>
                  <p>时间以服务端结算为准，消耗为估算值。</p>
                </details>
                {confirmAbandon ? (
                  <div
                    className={styles.confirm}
                    role="group"
                    aria-label="确认放弃训练"
                  >
                    <h3>放弃这次训练？</h3>
                    <p>
                      本次状态将记录为已放弃，不计入完成成果，也不会获得奖励。若想保留活动时间，请选择完成并保存。
                    </p>
                    <button
                      className="outline-button"
                      disabled={disabled}
                      onClick={() =>
                        void act(
                          "abandon",
                          { id: session!.id, version: session!.version },
                          async () => {
                            await api!.update(
                              session!.id,
                              "abandon",
                              session!.version,
                            );
                            accept(null);
                            go({ view: "home" });
                            setMessage("本次训练已放弃，未计入完成成果。");
                            await refresh();
                          },
                        )
                      }
                    >
                      确认放弃
                    </button>
                    <button
                      className="primary-button"
                      disabled={busy}
                      onClick={() => setConfirmAbandon(false)}
                    >
                      保留训练
                    </button>
                  </div>
                ) : (
                  <button
                    className={styles.textButton}
                    disabled={disabled}
                    onClick={() => setConfirmAbandon(true)}
                  >
                    放弃本次训练
                  </button>
                )}
              </aside>
            </div>
          ) : (
            <div className={styles.empty}>
              <p>{loading ? "正在恢复训练…" : "当前没有进行中的训练。"}</p>
              {navButton("选择课程", { view: "home" })}
            </div>
          )}
        </>
      )}
      {route.view === "result" &&
        (result ? (
          <section className={styles.resultCard}>
            <CheckCircle2 size={44} />
            <p className={styles.eyebrow}>WORKOUT SAVED</p>
            <h2>训练成果已保存</h2>
            <p>{titleFor(result.session.courseId)}</p>
            <div className={styles.resultMetrics}>
              <div>
                <strong>{timer(result.session.activeDurationSeconds)}</strong>
                <span>活动时间</span>
              </div>
              <div>
                <strong>{result.session.estimatedCaloriesKcal}</strong>
                <span>千卡（估算）</span>
              </div>
            </div>
            <p>{result.session.businessDate} · 上海时间</p>
            <div className={styles.rewardStatus}>
              <h3>本次奖励</h3>
              <p>
                {!result.session.rewardEligible
                  ? "未达奖励门槛，没有积分；训练成果已保留。"
                  : result.awards.length
                    ? `本次获得 ${result.awards.reduce((n, a) => n + a.points, 0)} 积分。`
                    : "本次具备奖励资格，未获得新积分。"}
              </p>
              <p className={styles.subtle}>
                同日同课程奖励不重复领取，实际积分以结算结果为准。
              </p>
            </div>
            <div className={styles.actions}>
              {navButton(
                "查看训练记录",
                { view: "records", date: result.session.businessDate ?? today },
                true,
              )}
              {navButton("回到运动首页", { view: "home" })}
            </div>
          </section>
        ) : (
          <div className={styles.empty}>
            <p>本页没有可展示的本次结算结果，可前往记录查看已保存训练。</p>
            {navButton("查看训练记录", { view: "records", date: today })}
          </div>
        ))}

      {route.view === "records" && (
        <section className="card">
          <div className={styles.recordsHeading}>
            <div>
              <h2>回看每一次努力</h2>
              <p className={styles.subtle}>
                按上海日期查看。完成、暂停与放弃分别展示。
              </p>
            </div>
            <div className={styles.dateShortcuts}>
              <button
                className={styles.textButton}
                disabled={busy || recordsBusy}
                onClick={() => {
                  const date = addDays(recordsDate, -1);
                  setRecordsDate(date);
                  go({ view: "records", date }, true);
                }}
              >
                前一天
              </button>
              <button
                className={styles.textButton}
                disabled={busy || recordsBusy || recordsDate === today}
                onClick={() => {
                  setRecordsDate(today);
                  go({ view: "records", date: today }, true);
                }}
              >
                今天
              </button>
            </div>
            <label>
              记录日期
              <input
                type="date"
                required
                max={today}
                value={recordsDate}
                disabled={busy || recordsBusy}
                onChange={(e) => {
                  if (validStartDate(e.target.value)) {
                    setRecordsDate(e.target.value);
                    go({ view: "records", date: e.target.value }, true);
                  }
                }}
              />
            </label>
            <button
              className="icon-button"
              aria-label="刷新训练记录"
              disabled={recordsBusy || disabled}
              onClick={() => setRecordsReload((n) => n + 1)}
            >
              <RefreshCw size={17} />
            </button>
          </div>
          {!api ? (
            <p className={styles.empty}>接入训练服务后显示你的训练记录。</p>
          ) : recordsBusy ? (
            <p className={styles.empty}>正在读取记录…</p>
          ) : recordsError ? (
            <div className={styles.error} role="alert">
              {recordsError}
              <button
                className="outline-button"
                onClick={() => setRecordsReload((n) => n + 1)}
              >
                重试读取
              </button>
            </div>
          ) : !records.length ? (
            <div className={styles.empty}>
              <Clock size={28} />
              <h3>这一天，还没有训练记录</h3>
              <p>可以换个日期，或从一节课程开始。</p>
              {navButton("选择课程", { view: "home" })}
            </div>
          ) : (
            <>
              <div className={styles.pills}>
                <span>
                  {records.filter((s) => s.status === "completed").length}
                  {recordsCursor ? "＋" : ""} 次已完成
                </span>
                <span>
                  {records
                    .filter((s) => s.status === "completed")
                    .reduce((n, s) => n + s.estimatedCaloriesKcal, 0)
                    .toFixed(1)}{" "}
                  千卡（估算）
                </span>
              </div>
              {recordsCursor && (
                <p className={styles.subtle}>仅汇总已加载的记录。</p>
              )}
              {recordList(records)}
            </>
          )}
          {recordsCursor && (
            <button
              className="outline-button"
              disabled={disabled || recordsBusy}
              onClick={() => {
                const seq = recordsSequence.current;
                setRecordsBusy(true);
                setRecordsError("");
                void api!
                  .history(recordsDate, recordsDate, recordsCursor)
                  .then((p) => {
                    if (seq === recordsSequence.current) {
                      setRecords((r) => [...r, ...p.items]);
                      setRecordsCursor(p.nextCursor);
                    }
                  })
                  .catch((e) => {
                    if (seq === recordsSequence.current)
                      setRecordsError(errorText(e));
                  })
                  .finally(() => {
                    if (seq === recordsSequence.current) setRecordsBusy(false);
                  });
              }}
            >
              加载更多记录
            </button>
          )}
        </section>
      )}

      {route.view === "reminder" && (
        <div className={styles.detailGrid}>
          <section className="card">
            <div className={styles.savedState}>
              <Bell size={22} />
              <div>
                <h2>
                  {!api
                    ? "服务待接入"
                    : !reminderReady
                      ? loading
                        ? "正在读取设置"
                        : "设置尚未同步"
                      : reminder === null
                        ? "尚未设置训练提醒"
                        : reminder.enabled
                          ? "提醒设置已保存"
                          : "训练提醒已关闭"}
                </h2>
                <p>
                  {reminder?.enabled && reminder.nextTriggerAt
                    ? `下次计划提醒：${new Date(reminder.nextTriggerAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`
                    : "选择适合自己的时间，不必每天重复设置。"}
                </p>
              </div>
            </div>
            {reminderDirty && (
              <p className={styles.draftStatus} role="status">
                有未保存的设置，点击保存后才会生效。离开此页将放弃未保存的修改。
              </p>
            )}
            <form
              className={styles.reminderForm}
              onSubmit={(e) => {
                e.preventDefault();
                void act("reminder", draft, async () => {
                  const r = await api!.saveReminder({
                    ...draft,
                    weekdays: [...draft.weekdays],
                    channels: [...draft.channels],
                  });
                  setReminder(r);
                  setMessage(
                    r.enabled
                      ? "提醒设置已保存，实际送达取决于所选通道。"
                      : "训练提醒已关闭。旧设置不再安排新的提醒。",
                  );
                });
              }}
            >
              <label className={styles.switchRow}>
                <span>
                  <strong>训练日程提醒</strong>
                  <small>按选定的星期与时间提醒</small>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  aria-label="开启训练提醒"
                  disabled={busy || !reminderReady}
                  checked={draft.enabled}
                  onChange={(e) =>
                    changeDraft({ ...draft, enabled: e.target.checked })
                  }
                />
              </label>
              <label>
                提醒时间（上海）
                <input
                  required
                  type="time"
                  disabled={busy || !reminderReady}
                  value={draft.localTime}
                  onChange={(e) =>
                    changeDraft({ ...draft, localTime: e.target.value })
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
                        disabled={busy || !reminderReady}
                        checked={draft.weekdays.includes(i + 1)}
                        onChange={(e) =>
                          changeDraft({
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
                <legend>提醒方式</legend>
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
                      disabled={
                        busy ||
                        !reminderReady ||
                        (!supported && !draft.channels.includes(id))
                      }
                      checked={draft.channels.includes(id)}
                      onChange={(e) =>
                        changeDraft({
                          ...draft,
                          channels: e.target.checked
                            ? [...draft.channels, id]
                            : draft.channels.filter((c) => c !== id),
                        })
                      }
                    />
                    <span>
                      {label}
                      <small>
                        {!supported
                          ? "暂未接入，当前不可选择"
                          : id === "in_app"
                            ? "进入产品后查看站内通知"
                            : "是否送达受系统权限与通道状态影响"}
                      </small>
                    </span>
                  </label>
                ))}
              </fieldset>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  disabled={busy || !reminderReady}
                  checked={draft.skipIfCompleted}
                  onChange={(e) =>
                    changeDraft({ ...draft, skipIfCompleted: e.target.checked })
                  }
                />
                <span>
                  当日已有效完成训练时跳过
                  <small>
                    按当前规则，达到奖励资格门槛的已完成训练才触发跳过。
                  </small>
                </span>
              </label>
              {draft.enabled &&
                (!draft.weekdays.length || !draft.channels.length) && (
                  <p role="status" className={styles.validation}>
                    请至少选择一个星期和一种提醒方式。
                  </p>
                )}
              <button
                className="primary-button"
                disabled={
                  disabled ||
                  !reminderReady ||
                  (draft.enabled &&
                    (!draft.weekdays.length || !draft.channels.length))
                }
              >
                {busy ? "正在保存…" : "保存提醒设置"}
              </button>
            </form>
          </section>
          <aside className={styles.stickyCard}>
            <Info size={22} />
            <h2>知道提醒会怎样发生</h2>
            <ol className={styles.explainSteps}>
              <li>
                <strong>保存时间与星期</strong>
                <p>保存的是你的提醒偏好。</p>
              </li>
              <li>
                <strong>到期时核对训练状态</strong>
                <p>修改、关闭或满足跳过条件时，不继续发送旧任务。</p>
              </li>
              <li>
                <strong>通过可用通道通知</strong>
                <p>设置保存成功不等于通知已送达。</p>
              </li>
            </ol>
            <p className={styles.notice}>
              这里设置日程提醒。组间休息计时属于训练中的另一类工具，本期尚未提供。
            </p>
          </aside>
        </div>
      )}
      <footer className="page-footer">
        动得开心，比数字更重要。
        <span>按自身情况调整节奏 · 活动时间与成果以同步结算为准</span>
      </footer>
    </div>
  );
}
