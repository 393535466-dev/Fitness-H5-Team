/** M04 subpages share /training so the team shell and provider stay mounted. */
export const views = [
  "home",
  "plans",
  "plan",
  "course",
  "learn",
  "session",
  "result",
  "records",
  "reminder",
] as const;
export type TrainingView = (typeof views)[number];
export interface TrainingRoute {
  view: TrainingView;
  id?: string;
  from?: "session" | "plan";
  templateId?: string;
  date?: string;
}
export function readTrainingRoute(search: string): TrainingRoute {
  const p = new URLSearchParams(search),
    v = p.get("view");
  const view = views.includes(v as TrainingView) ? (v as TrainingView) : "home";
  const id = p.get("id") || undefined;
  const date = p.get("date") || undefined;
  return {
    view,
    id,
    from:
      p.get("from") === "session"
        ? "session"
        : p.get("from") === "plan"
          ? "plan"
          : undefined,
    templateId: p.get("templateId") || undefined,
    date:
      date &&
      /^[1-9]\d{3}-\d{2}-\d{2}$/.test(date) &&
      !Number.isNaN(Date.parse(date + "T00:00:00Z")) &&
      new Date(date + "T00:00:00Z").toISOString().slice(0, 10) === date
        ? date
        : undefined,
  };
}
export function trainingHref(route: TrainingRoute): string {
  const p = new URLSearchParams();
  if (route.view !== "home") p.set("view", route.view);
  if (route.id) p.set("id", route.id);
  if (route.from) p.set("from", route.from);
  if (route.templateId) p.set("templateId", route.templateId);
  if (route.date) p.set("date", route.date);
  return "/training" + (p.size ? "?" + p : "");
}
export const addDays = (d: string, n: number) =>
  new Date(Date.parse(d + "T00:00:00Z") + n * 86400000)
    .toISOString()
    .slice(0, 10);
export const shanghaiToday = () =>
  new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
export const monday = (d: string) =>
  addDays(d, -((new Date(d + "T00:00:00Z").getUTCDay() + 6) % 7));
export function validStartDate(date: string): boolean {
  return (
    !!date &&
    /^[1-9]\d{3}-\d{2}-\d{2}$/.test(date) &&
    !Number.isNaN(Date.parse(date + "T00:00:00Z")) &&
    new Date(date + "T00:00:00Z").toISOString().slice(0, 10) === date
  );
}
