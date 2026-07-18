# 目标项目结构

```text
api/                         # 三个 Vercel Function 网关
  app.ts
  integrations.ts
  jobs.ts
apps/web/src/
  app/                       # 启动、路由、应用壳
  platform/                  # Telegram、会话、HTTP、查询缓存
  features/                  # 与服务端同名的业务域
  shared/                    # 无业务裁决的 UI 与反馈
chain/ton/                   # Tact 合约、元数据 schema、部署命令
packages/contracts/          # 唯一路由 registry、Zod、OpenAPI
packages/server/src/
  http/                      # 契约边界与三个 gateway dispatcher
  modules/                   # 业务垂直模块
  platform/                  # DB、Telegram、TON、环境
  jobs/                      # 四个持久恢复/监控任务
supabase/
  schemas/                   # 声明式数据库真相
  migrations/                # 仅三条一次性 migration
tools/catalog/               # 从功能说明生成目录
tools/db/                    # migration 生成与漂移检查
tools/web/                   # 正式 TON Connect manifest 生成
docs/product/                # 唯一功能说明
docs/architecture/           # 基线、迁移和架构决策
ops/                         # 发布与真实验收手册
```

依赖方向固定为：Web → contracts；API entry → server/http；server → contracts + service-role RPC。浏览器不得依赖 server、Supabase 或数据库类型，业务写入不得绕过 `api` schema RPC。
