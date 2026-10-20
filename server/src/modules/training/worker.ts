import type { UnitOfWork } from "./types";
import type { TrainingService } from "./service";
import { instant } from "./domain";
/** Scheduler/clock are supplied by M01; no timer or external push inside a transaction. */
export class TrainingReminderWorker {
  constructor(
    private service: TrainingService,
    private uow: UnitOfWork,
  ) {}
  async tick(now: string, limit = 50) {
    const due = await this.uow.readSnapshot((tx) =>
      this.service.repo.due(tx, instant(now), limit),
    );
    const results = [];
    for (const row of due) {
      results.push(
        await this.uow.runForUser(row.user_id, (tx, ctx) =>
          this.service.processDue(tx, ctx, {
            reminderId: row.id,
            reminderVersion: row.version,
            scheduledAt: instant(row.next_trigger_at!),
          }),
        ),
      );
    }
    return results;
  }
}
