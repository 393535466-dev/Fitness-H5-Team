# M04 训练计划与提醒 · 小组交付入口

本仓库基于组员前端 `guojunyu12/qingyang-health-frontend` 的 `7edf70467eb36d537702430881a5d5a153001ecc`。
本次仅实施 M04；此前的多运动、运动社交及商业路演属于历史产品探索，已另行存档，不作为本轮需求。

**状态：模块源码与交互预览可评审；公共服务尚未装配，不能视为真实全链路已上线。**

## 快速预览

```sh
npm ci
NEXT_PUBLIC_M04_PREVIEW=true npm run dev
```

打开 `http://127.0.0.1:3001/training`。顶部始终显示“交互预览”。数据只在内存中，刷新重置，不连接登录、MySQL、真实积分或推送。此开关只用于开发评审；生产构建不要设置它。

不设置预览开关且未注入 API 时，训练页显示“训练服务待接入”，不回落到假课程、假成果或本地积分。其他模块沿用组员原有演示状态，未由 M04 改造。

## 文件与边界

| 交付 | 路径 | 说明 |
| --- | --- | --- |
| 训练页面及请求适配 | `src/features/training/` | 课程、筛选/分页、详情、周计划、可恢复计时、今日记录、提醒 |
| 后端模块 | `server/src/modules/training/` | 领域规则、参数化 MySQL 查询、15 路由、Nest 装配工厂、提醒 Worker |
| 接口片段 | `contracts/openapi/M04.yaml` | OpenAPI 3.1，包含输入、输出、分页、权限及错误 |
| 本组种子 | `db/seeds/M04/001_courses_and_template.sql` | 固定课程/模板 UUID，7 天含 3 个休息日；不写用户/积分/成果 |
| 业务规则测试 | `tests/m04.test.ts` | 固定时钟及内存事务替身，不能代替数据库验收 |
| 真实 MySQL 测试入口 | `tests/m04/` | 必须显式配置独立测试库，否则跳过 |
| 契约原件与基线 | `docs/M04/reference/`、`BASELINE.json` | 只读追溯副本，不是新公共契约源 |
| 联调交接 | [HANDOFF.md](HANDOFF.md) | 必须阅读；包含差异、接入方式、待办与验收界限 |
| 预览截图 | `docs/M04/screenshots/` | 仅交互预览截图，不代表真实服务证据 |

## 检查

```sh
npm run typecheck
npm test
npm run build
# 单独运行真实 MySQL 套件；不设置连接时明确 skipped：
node node_modules/vitest/vitest.mjs run --config tests/m04/vitest.mysql.config.ts
```

旧 `tests/e2e/` 包含原先“本地演示立即打卡并获积分”的断言，该行为已由 M04 移除。旧用例归共享测试集维护，不应作为当前真实业务验收；M04 未改写其他模块的测试。当前浏览器实测及尚缺验收见 [VALIDATION.md](VALIDATION.md)。

## 先前工作存档

本次开发前已在用户工作区建立 `存档/2026-10-20_前期产品方案与汇报/`，保留 26 份历史文件、完整 ZIP 和逐文件 SHA-256 清单，原文件未删除。仓库不上传历史汇报大文件，存档说明见 [ARCHIVE.md](ARCHIVE.md)。
