# ADR-074：账号语言、默认英语与 en-US 游戏本地化

- 状态：已接受
- 日期：2026-08-16

## 背景

EvoMyPet 的现有界面、目录名称、任务、Battle 技能和 Telegram 外部文案只有简体中文，而主要玩家群体位于美国。单纯替换界面按钮不能覆盖数据库返回的藏品名、技能名、任务文案、操作恢复结果、错误信息、Stars 支付页、Battle 分享卡和 NFT 元数据；只在当前设备保存语言也不能满足同一 Telegram 账号跨设备一致。

五个主页共用固定顶部资产栏。新增常驻语言按钮会继续挤压玩家身份、VIP 和两种资产，不符合移动端顶部空间约束；语言入口必须复用现有左上角玩家身份位置。

## 决策

唯一支持的语言固定为 `en` 与 `zh-CN`，界面固定显示 `English / 简体中文`。未认证首帧、新账号和没有有效本地提示的首次进入固定使用 `en`；不根据 Telegram `language_code`、设备语言、IP 或地区自动改写。`identity.users.preferred_language` 是账号偏好的最终事实来源，默认值为 `en`，只接受上述两个值。

认证正常结果、`identity.initial` 和 `identity.summary` 都返回 `preferred_language`。`POST /api/me/language` 只接受当前 bearer session 与 `{ preferred_language }`，数据库通过 `api.identity_set_preferred_language` 重新验证 session、账号状态和允许值后写入；相同值重复写入不产生不同结果。该偏好不属于资产或随机结果，不创建 operation，也禁止 `Idempotency-Key`。Web 先在本地切换，写入失败立即恢复原语言；写入成功后刷新当前活动查询。下次登录和其他设备以数据库值覆盖本地提示。

浏览器只允许按 Telegram 数字 ID 保存版本化语言提示，用于认证完成前避免首帧闪回；提示不保存 session、业务数据或账号控制权，也不能覆盖认证返回值。无 Telegram ID 时不持久化。语言切换同步设置根节点 `lang` 与 `data-language`，数字和日期使用当前语言的 `Intl` locale。

左上角身份字首、名称和用户名整体成为账号菜单按钮，不新增顶部控件，不改变 `66px` 顶部栏、Telegram safe area 或 content safe area 计算。点击后通过全局 `AppModal` Portal 打开底部账号菜单，提供两个互斥语言选项；菜单遵守底部安全区、焦点、关闭、滚动锁和至少 `44px` 触控目标。该顶部栏存在于所有主页面，因此五个主导航页面均可访问语言菜单。

完整 en-US 词库和共享游戏内容注册表通过 `@evomypet/api-contracts/localization` 独立边界加载；Web 仅允许 `platform/i18n/catalog.ts` 使用该边界，服务端仅在需要固定英文 NFT 元数据时读取。入口先用直接 en-US/简体中文启动文案显示既有启动页，并并行准备完整词库；完整词库成功前不挂载可操作主界面，失败时留在玩家可重试的启动页，因此默认英语不会产生中文闪屏。账号菜单和 `AppModal` 同样按玩家指针、焦点或点击意图动态加载，不进入首屏静态闭包。

静态界面文案由 Web i18n 层统一选择；API 稳定错误码由独立的 en-US 玩家文案映射呈现，不直接向玩家展示数据库或内部错误说明。藏品、图鉴链主题、Battle 技能、任务字段和盲盒名称使用 `@evomypet/api-contracts/localization` 中的共享冻结注册表，分别固定覆盖 210 个模板、70 条链、50 个技能、17 项任务的 34 个文本字段和 3 种盲盒。注册表每项同时保留稳定实体 ID、简体中文名称与专业 en-US 名称；英语名称以美国游戏玩家的辨识习惯命名，不作逐字硬译。

模板 ID、chain ID、skill ID、task code、稀有度、属性、数值、概率、经济规则、图片路径、战斗配置和业务裁决全部保持不变。Web 只在展示时按当前语言解析名称；中文继续显示原正式名称。NFT 元数据是全局不可变公开资料，不按查看者动态变化，固定使用共享注册表的 en-US 藏品名；其 Template、Rarity、Stage 和 Combat Power 属性保持原值。

Stars invoice、pre-checkout 失败提示和 Battle prepared share 在服务端读取发起账号的 `preferred_language` 后生成对应语言；无法建立账号上下文的公开支付支持入口固定使用默认英语。任何 Telegram Stars 支付仍只能由玩家本人在 Telegram 原生支付界面确认，本 ADR 不授权或触发实际支付。

`pnpm i18n:check` 固定检查：活动 Web 源码中的简体中文必须位于 `t/tp/tr/localized` 边界内，插值值不得夹带未本地化中文；每个中文键必须存在英语文案；英语值不得残留汉字；冻结内容数量必须保持 `210/70/50/34/3`。该检查进入 `validate:static`，但不能替代真实 Telegram 验收。

## 兼容与迁移

项目尚未正式上线，因此直接修正声明式 identity、payment callback 和 Battle schema、原始 baseline 与 `api_security` migration，不追加补丁 migration。真实开发数据库从空库执行完整三份 migration 后，同一 commit 的 API 和 Web 一起切换；旧 WebView 必须关闭后从 Telegram 重新进入。

现有开发账号在重建后使用默认英语。后续生产迁移若已有用户数据，必须为缺失偏好填入 `en`，不得从 Telegram `language_code` 猜测用户选择。

## 验收

静态门禁必须通过 Prettier、ESLint、全仓 TypeScript、OpenAPI 漂移、`i18n:check`、数据库声明与三迁移同步、权限 allowlist、架构检查和生产构建。

真实 iPhone Telegram 与 Safari Web Inspector 必须在同一部署 SHA 验证：首次进入直接显示英语且没有中文闪现；五个主页面点击左上角身份都打开同一账号菜单；菜单不增加顶部高度、不与 Telegram 原生控件重叠、不挤压资产；切到简体中文后当前页、其他主页面、弹窗、错误、210 个藏品、技能和任务均切换；关闭后重开仍保留；同一 Telegram 账号在另一设备登录后使用相同选择；再切回 English 后两台设备下次启动均显示英语。网络面板必须只有同源 `POST /api/me/language`，浏览器不得连接 Supabase Data API。静态、普通浏览器或部署 READY 不能替代真机结论。
