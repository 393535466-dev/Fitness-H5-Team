import { describe, expect, it } from "vitest";
import {
  readTrainingRoute,
  trainingHref,
  addDays,
  monday,
  validStartDate,
} from "../src/features/training/navigation";
describe("M04 shareable secondary page boundaries", () => {
  it("rejects unknown views and impossible history dates", () => {
    expect(readTrainingRoute("?view=unknown&date=2026-02-30")).toMatchObject({
      view: "home",
      date: undefined,
    });
    expect(readTrainingRoute("?view=records&date=2026-10-21")).toMatchObject({
      view: "records",
      date: "2026-10-21",
    });
  });
  it("preserves the route back from learning to a plan without interpreting its identifiers", () => {
    const route = {
      view: "learn" as const,
      id: "course & one",
      from: "plan" as const,
      templateId: "template/one",
    };
    const href = trainingHref(route);
    expect(readTrainingRoute(href.slice(href.indexOf("?")))).toEqual({
      ...route,
      date: undefined,
    });
    expect(trainingHref({ view: "home" })).toBe("/training");
  });
  it("keeps calendar calculations stable over year and leap-day boundaries", () => {
    expect(addDays("2026-12-30", 6)).toBe("2027-01-05");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(monday("2027-01-03")).toBe("2026-12-28");
    expect(validStartDate("2026-02-29")).toBe(false);
    expect(validStartDate("")).toBe(false);
    expect(validStartDate("0000-01-01")).toBe(false);
    expect(validStartDate("2028-02-29")).toBe(true);
  });
});
