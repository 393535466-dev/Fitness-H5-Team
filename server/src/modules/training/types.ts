/** Exact shared contract is retained under docs/M04/reference, owned by M01. */
export type {
  UUID,
  Instant,
  ISODate,
  CommandContext,
  SqlTx,
  UnitOfWork,
  CourseDto,
  WorkoutSessionDto,
  CurrentWorkoutDto,
  WorkoutStatus,
  TrainingReminderInput,
  TrainingReminderDto,
  PointsPort,
  PointAwardDto,
  MediaPort,
  OutboxPort,
  TrainingQueryPort,
  TrainingDay,
} from "../../../../docs/M04/reference/shared-types";
import type {
  CourseDto,
  WorkoutSessionDto,
  TrainingReminderDto,
  PointAwardDto,
  SqlTx,
  CommandContext,
} from "../../../../docs/M04/reference/shared-types";
export interface CourseRow {
  id: string;
  title: string;
  category: CourseDto["category"];
  level: CourseDto["level"];
  description: string;
  cover_asset_id: string | null;
  video_asset_id: string | null;
  estimated_duration_seconds: number;
  estimated_calories_kcal: number | string;
  status: CourseDto["status"];
  version: number;
  created_at: string;
  updated_at?: string;
}
export interface SessionRow {
  id: string;
  user_id: string;
  course_id: string;
  status: WorkoutSessionDto["status"];
  started_at: string;
  active_since: string | null;
  accumulated_seconds: number;
  active_duration_seconds: number;
  ended_at: string | null;
  business_date: string | null;
  duration_snapshot_seconds: number;
  calories_snapshot_kcal: number | string;
  reward_threshold_seconds: number;
  estimated_calories_kcal: number | string;
  reward_eligible: 0 | 1;
  version: number;
  created_at: string;
  updated_at?: string;
}
export interface ReminderRow {
  id: string;
  user_id: string;
  enabled: 0 | 1;
  local_time: string;
  timezone: "Asia/Shanghai";
  weekdays: number[] | string;
  channels: TrainingReminderDto["channels"] | string;
  skip_if_completed: 0 | 1;
  next_trigger_at: string | null;
  version: number;
}
export interface PlanItem {
  id: string;
  scheduledDate: string;
  courseId: string | null;
  restDay: boolean;
  sortOrder: number;
}
export interface PlanDto {
  id: string;
  title: string;
  templateId: string | null;
  startDate: string;
  endDate: string;
  status: "active" | "archived";
  items: PlanItem[];
}
export interface TemplateDto {
  id: string;
  title: string;
  description: string;
  days: { dayOffset: number; restDay: boolean; courseIds: string[] }[];
}
export interface CompletionDto {
  session: WorkoutSessionDto;
  awards: PointAwardDto[];
}
export interface Capability {
  inApp: boolean;
  webPush: boolean;
  appPush: boolean;
}
/** Integration proposals, not alternate implementations of M01/M05 infrastructure. */
export interface TrainingAuditPort {
  recordInTransaction(
    tx: SqlTx,
    ctx: CommandContext,
    input: {
      action: string;
      resourceType: "training_course";
      resourceId: string;
      changeSummary: Record<string, unknown>;
    },
  ): Promise<void>;
}
export interface WorkoutAwardsQueryPort {
  forWorkout(
    tx: SqlTx,
    userId: string,
    sessionId: string,
  ): Promise<PointAwardDto[]>;
}
