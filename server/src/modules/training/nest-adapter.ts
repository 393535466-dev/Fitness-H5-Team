import {
  trainingRoutes,
  trainingHandler,
  type TrainingExecutionPort,
  type TrainingRequest,
} from "./http";
import type { TrainingService } from "./service";

/** Pass decorators from the ONE installed @nestjs/common owned by M01.
 * Manual decorator application avoids a second Nest dependency / root lock change.
 * createTrainingModule(Nest, service, sharedExecutor) returns an ordinary Nest module.
 * Authentication/admin/CSRF/idempotency are enforced by the required executor. */
export interface NestDecorators {
  Controller(path: string): ClassDecorator;
  Module(metadata: { controllers: Function[] }): ClassDecorator;
  Get(path: string): MethodDecorator;
  Post(path: string): MethodDecorator;
  Patch(path: string): MethodDecorator;
  Put(path: string): MethodDecorator;
  Req(): ParameterDecorator;
  Res(): ParameterDecorator;
}
export function createTrainingModule(
  nest: NestDecorators,
  service: TrainingService,
  executor: TrainingExecutionPort,
) {
  if (typeof executor?.execute !== "function")
    throw Error("M04 requires the shared authenticated command executor");
  class TrainingController {}
  for (const [i, route] of trainingRoutes(service).entries()) {
    const key = `route${i}`,
      handle = trainingHandler(service, executor, route);
    Object.defineProperty(TrainingController.prototype, key, {
      value: async (
        request: TrainingRequest,
        response: { status(n: number): { json(value: unknown): void } },
      ) => {
        const r = await handle(request);
        response.status(r.status).json(r.body);
      },
      configurable: true,
    });
    const descriptor = Object.getOwnPropertyDescriptor(
      TrainingController.prototype,
      key,
    )!;
    const decorator =
      route.method === "GET"
        ? nest.Get
        : route.method === "POST"
          ? nest.Post
          : route.method === "PATCH"
            ? nest.Patch
            : nest.Put;
    decorator(route.path)(TrainingController.prototype, key, descriptor);
    nest.Req()(TrainingController.prototype, key, 0);
    nest.Res()(TrainingController.prototype, key, 1);
  }
  nest.Controller("api/v1")(TrainingController);
  class TrainingModule {}
  nest.Module({ controllers: [TrainingController] })(TrainingModule);
  return TrainingModule;
}
