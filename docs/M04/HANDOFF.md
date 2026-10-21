# M04 联调交接单

## 理解核对与完成范围

当前需求以用户提供的 `M04_训练计划与提醒_Agent工作包.md`、`01_数据库中文字段字典.md` 为准，契约 QY-MYSQL-1.0.0，MySQL 8.4 / InnoDB / V001。本组只写 `training_courses`、`training_plan_templates`、`training_template_items`、`training_plans`、`training_plan_items`、`workout_sessions`、`training_reminders` 七张表。

先交课程/模板和 QueryPort，再实现 current 与服务端分段计时，最后接同事务奖励和提醒意图。以上模块源码均已编写；**缺失公共实现使真实联调尚未完成**。

没有修改其他功能模块、共享 health-provider、全局 API 客户端、根依赖与锁文件或已发布 schema；没有另建用户/积分存储，没有执行生产建库，没有关闭外键。本地也未使用 SQLite/MariaDB 冒充 MySQL 验收。

## 实际基线与差异

| 项目 | 观察 | 本次处理 / 后续责任 |
| --- | --- | --- |
| 指定目标仓库 | 开始时为空仓库 | 本地保留组员前端真实 Git 历史；远端经 GitHub 接口发布内容完全一致的基线快照，再单独提交 M04，保存来源 commit |
| 前端 | Next.js / React / TypeScript，浅紫色 H5，原训练依赖 localStorage 演示打卡 | 保留视觉和路由，只替换 `src/features/training/` |
| 公共请求器 | 尚无 `src/lib/api/client.ts` | 交付注入适配器，不复制全局 fetch/登录逻辑；默认未接入状态 |
| 后端 | 组员 `qingyang-health-backend` 当前只有基线/文档，没有可运行 M01/M05 | 交付不含替代底座的业务模块，装配由 M01 完成 |
| 目录映射 | 后端仓库说明把原 `server/src` 映射为该独立仓库 `src`；当前目标仓库为前后端同仓 | 本次落在工作包的 `server/src/modules/training/`；迁入独立后端时整体迁该目录，由 M01 确认统一路径并替换公共类型导入路径 |
| `server/` | 原前端 `.gitignore` 整目录忽略 | 仅强制跟踪本组模块源码，保留忽略策略；不上传后端依赖、配置或密钥 |
| 身份设计 | 后端另有邮箱登录设计；V001 仍保留原字段 | 不改账号字段和契约，由 M01 统一发布；业务只接认证后的 ctx |
| V001 | 附录提取 SHA 与工作包一致 | `64ec33a66c813321d12a7bbc29eff4d3981d6d3f3eacf6fc1eb7f9265efd3c56`；追溯副本禁止当增量迁移重复部署 |

这里的 BASELINE.json 是本组来源记录，不冒充 M01 发布的 project_baseline/schema_manifest/CHECKSUMS；未获取全团队完整发布包，未宣称通过全包发布检查。

## M01 前端接入

调用 `createTrainingApi(sharedTransport)`，再由应用装配层提供 `TrainingApiProvider` 或 `<Training api={api} />`。

```tsx
const api = createTrainingApi({
  request: input => sharedClient.request(input),
  invalidateHealth: date => invalidateHealth(date),
});
// 在 M01 装配层：
<TrainingApiProvider api={api}>{children}</TrainingApiProvider>
```

`sharedTransport.request<T>` 必须返回共享 `Envelope<T>`。其参数为 `{method,path,body?,idempotencyKey?}`，path 已含 `/api/v1`。共享客户端负责同站 Cookie、CSRF、`X-Client-Platform:h5`、POST 幂等头、401 登录与刷新单飞；错误需暴露 `{status,code,message}`。以上是本组适配入口形状，M01 可在装配层映射现有客户端，而不是改造其他模块来适配本组。

页面不会把 DTO 原样回写提醒：仅提交共享 Input 声明的字段。POST 的同操作失败重试复用 key；切换到新的训练/version/计划输入生成新 key。提交中禁用按钮，不先增加成果或积分。失败、409、网络恢复和页面回到前台会重新读取 current。计时基数直接采用服务端 current 同一 `serverNow` 结算的 `activeDurationSeconds`，用单调时钟推算显示；显示值从不回传服务端。

完成后调用 `invalidateHealth(businessDate)`；更换计划后也触发共享刷新。提醒写失败保留弹层并显示错误，版本冲突读取新配置供重试。清除/替换登录身份时 M01 应卸载旧 Provider 与页面、清空共享用户缓存，禁止跨用户复用实例。

## M01 后端装配（必要前置）

所需公共依赖由 M01 统一在**后端**安装和锁定：`@nestjs/common`、Nest 的既定运行依赖、`mysql2/promise`；测试沿用本仓库 Vitest。M04 没改根 package.json/package-lock.json，也没创建另一套服务包。

1. 将本组 `types.ts` 指向 M01 真正发布的公共类型路径；当前只读参考导入用于在缺少完整底座的仓库内进行类型核对，不改变公共类型。
2. 建立 `SqlTrainingRepository`，注入共享 PointsPort、OutboxPort、MediaPort、审计端口、通知能力，以及**统一配置** `rewardThresholdRatio`（本轮为 0.8）。除纯课程查询外，缺失公共写依赖不得用成功空实现替代。
3. `createTrainingModule(Nest, trainingService, sharedExecutor)` 返回普通 Nest 模块；工厂接收 M01 已安装的 Nest 装饰器，避免新增重复 Nest 依赖。加入根模块只由 M01 操作。
4. **sharedExecutor 是安全和事务边界，必须真实实现后才可开放路由。** 负责身份、管理员、平台、CSRF、POST key/bodyHash/租约/缓存、响应和错误 envelope，以及 readSnapshot / 用户行锁事务。客户端请求中不得接受 ctx/userId/operationNow。用户命令锁序为 users → 本请求幂等 → 业务资源 → 积分账户 → outbox。M04 无 commit、rollback、新连接或本地用户真相。
5. 每次连接设置 `time_zone='+00:00'`，驱动 DATE/DATETIME 返回字符串、DECIMAL 显式转换。传给命令的 ctx 必须在事务中取得一次固定 operationNow，重试返回原缓存结果；失败回滚整个事务。统一错误处理器还需捕获 CLOCK_MOVED_BACKWARDS 记录技术事件并提示稍后重试。
6. 共享 executor 用 `RoutePolicy.status`、access、idempotent 控制状态码和授权，公共错误按契约映射。`TrainingError.fields` 为普通字段错误；`details.sessionId`、`details.deliveryCapability` 是内部错误上下文，不能丢失恢复信息。见下方待确认变更单。
7. 公开课程读取在快照结束后经 `trainingHandler` 签名素材，不在持锁事务中发起签名/网络工作。admin_material 检查在事务内使用 MediaPort.assertReady；管理员端不混入普通 H5 导航。视频可缺省。

`TrainingService.queryPort()` 提供共享 TrainingQueryPort，仅查询传入 tx，只汇总 completed（含未达奖励门槛但真实保存的训练），排除 paused/abandoned。推荐课程先取当天计划，再回退到已发布课程。M02 聚合最终消费以数值 DTO 为准。QueryPort 的 Course 封面/视频默认 null；M02 需要媒体时同样在快照后走共享媒体授权。

## M05 完成与重试

完成操作先持锁读取本人的训练，用服务端时间结算并条件更新终态，然后在同一个 tx 调用 `PointsPort.awardInTransaction(tx,ctx,{type:'workout_completed',sourceId})`。不传额度或 scope；异常向上抛给 UoW，使训练与积分整体回滚。

80% 门槛、课程时长与热量均在开始时快照。479 秒也能 completed，但不调用奖励端口；480 秒才具备资格。奖励资格不保证本次增加积分，同课程/日去重由 M05 决定。热量封顶，但实际时长不裁剪。

**待确认变更单 M04-C01：已完成训练跨幂等 key 重试时的原奖励查询。** 共享 PointsPort 仅含 award/ensureAccount，没有按来源读取原 awards 的方法；工作包却要求重复完成返回原结果。M04 不读取他组积分表，也不再次 award。当前必须注入模块私有 `WorkoutAwardsQueryPort.forWorkout(tx,userId,sessionId)`；请 M05 提供“该来源首次完成返回的 awards”，未获奖返回 []，并由 M01/M05 确认最终共享接口。它不是已批准的公共类型变更，也没有本地成功替身。相同 key 的完整原响应仍由 M01 幂等缓存重放。

## 提醒 Worker 与通知消费

M01 调度器调用 `TrainingReminderWorker.tick(clock.now())`：先短快照扫描到期提醒，再逐用户 `runForUser`，重读 enabled/version/next_trigger_at。已变更或已推进的旧任务直接退出。判断 scheduledAt 所属上海日期是否存在 completed 且 reward_eligible=1；仅这种成果可触发跳过。

未跳过时，推进 next_trigger_at 与 `training.reminder.due.v1` outbox 同事务提交。任务晚到时从当前 operationNow 计算下一次未来时间，避免补发一串过期提醒。事件键为 `training.reminder.due.v1:reminderId:reminderVersion:scheduledAt`。Worker 不修改配置 version；用户修改才加一。

M01 消费事件创建通知前，仍须在用户锁事务里调用 `validateNotification(tx,payload)`，复核当前配置并使用 M01 的事件键/通知去重，关闭或改版后的旧事件不得投递。站内通知与各通道投递表、供应商发送和重试都属于 M01，M04 不写这些表。没有供应商时不能宣称推送成功。

**待确认变更单 M04-C02：错误上下文。** 工作包要求 WORKOUT_IN_PROGRESS 返回 sessionId、UNSUPPORTED_CHANNEL 返回能力；公共 ApiError 只有字符串 fields。M01 可将 `details.sessionId` 映射为 `error.fields.sessionId`，能力逐项映射字符串，或发布一致的扩展 DTO。当前页面在冲突后读 current，在提醒读取中采用共享 deliveryCapability；不自行修改公共错误定义。

**待确认接入 M04-C03：审计与初始通知能力。** 工作包没有给出审计端口形状，模块使用私有 `TrainingAuditPort.recordInTransaction`，需映射到 M01 审计实现。未设置提醒的 GET 为 null，无法携带通道能力；页面因此保守关闭 web/app push，读到配置后按 DTO 显示能力。若要在首建时开放这些通道，应由 M01 增加统一能力来源，不能伪造提醒 ID。站内通道可用性必须由真实服务能力配置。

## 数据库与验收

当前设备未提供 MySQL 8.4 连接、独立开发库和 M01 的用户夹具；没有擅自初始化其他人的数据库。

真实库测试只接受 `qingyang_m04_test`，必须先由 M01 初始化原版 V001 和 test_user_a，再执行本组 seed。M04 seed 不创建用户，也不灌入示例训练成果。测试会清理该专用库中 test_user_a 的**本组**训练/计划/提醒记录，拒绝使用其他库名。

```sh
# mysql2 安装在 M01 的 server/node_modules（或已有根依赖中），连接仅走环境变量：
# M04_MYSQL_TEST_URL=mysql://<test-user>:<password>@127.0.0.1:3306/qingyang_m04_test
node node_modules/vitest/vitest.mjs run --config tests/m04/vitest.mysql.config.ts
```

该套件验证真实锁、条件唯一、JSON/DECIMAL、计划替换和数据库回滚；奖励/Outbox 仍为测试替身，**不等于 M01/M05 端到端验收**。真实登录/管理员守卫、Cookie/CSRF、幂等租约重放、同事务积分账本、媒体、通知投递仍需在完整服务装配后联调。供应商未配置不阻塞训练记录测试，但奖励核心事务不能以异步补分替代。

## 2026-10-21 · 前端二级页面更新

V2 将弹层流程改为 `/training?view=...` 下完整页面；Provider 注入方式、15 个后端接口、七表、共享 DTO 和 Worker 保持既有契约。页面路由与日期工具位于 `src/features/training/navigation.ts`；`Training` 在模块内提供 Suspense 边界，兼容生产预渲染的 useSearchParams。

学习仍使用 CourseDto.description/videoUrl，不引入独立动作库或学习进度数据。模板选择先预览日期并确认替换，API 返回的计划作为保存结果；健康看板刷新失败单独提示，不能误报已经提交的训练/计划保存失败。正式内容与结构化扩展要求见 CONTENT-CHECKLIST。支持复制 URL，但开发预览的内存记录在刷新时重置；生产应由原 current/history/plan 接口恢复。

未装配 API 时不会显示模拟课程或模拟成果，未知汇总显示“待同步 / —”。这版仍需 M01/M05 的真实联调，不能因二级页面可操作就标记全链路上线。
