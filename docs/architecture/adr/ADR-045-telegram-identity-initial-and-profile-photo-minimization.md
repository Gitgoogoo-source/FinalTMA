# ADR-045：Telegram 身份字首与头像数据最小化

- 状态：已接受
- 日期：2026-08-09

## 背景

Telegram 签名 `initData` 可以携带用户 `photo_url`。现有登录链把该 URL 写入 `identity.users`、身份 bootstrap 与 Battle 邀请 DTO，Web 再直接用作 `<img src>`。项目 CSP 的 `img-src` 只允许同源、内嵌图片和 Supabase `pet-runtime` 宠物图片，因此真实 iPhone Telegram WebView 会拒绝 `https://t.me/i/userpic/...`，顶部身份展示退化并产生控制台错误。为该外部地址扩展 CSP 会新增浏览器外部图片访问和持续的数据来源边界。

## 决策

产品不展示 Telegram 真实用户头像。顶部身份标识、Battle 挑战卡和接受预览统一显示当前展示名称的第一个 Unicode 字符；展示名称继续按“名字与姓氏组合 → username → `PokePets`”回退。字首只由已验证的文本身份字段计算，不请求、缓存、代理、上传或持久化任何真实头像。

认证端点仍必须验证 Telegram 原始 `initData` 的完整签名，但验证完成后只构造允许字段白名单，主动丢弃 user、receiver 与 chat 对象中的 `photo_url`。`identity.users`、登录 RPC、身份 bootstrap、Battle viewer-specific DTO、OpenAPI 和 Web props 均不得包含头像 URL。CSP 保持原有 `img-src`，不得为用户头像增加 `t.me`、Telegram CDN 或新的 Storage 桶。

宠物目录图片、图鉴图片、Telegram 项目公开展示图和 Battle lobby 固定红蓝阵营 WebP 不属于用户真实头像，继续按各自既有资源裁决运行。

## 数据与契约不变量

- Telegram ID、名字、姓氏、username、语言、账号状态、邀请码、session、入口交接与身份幂等规则不变。
- 浏览器仍不接收 Supabase SDK、密钥或 Data API 能力，也不新增头像代理、缓存、对象存储或后台任务。
- `BattleChallengeCardDto` 与 `BattleInvitePreviewDto` 继续返回 `creator_display_name`，但不返回 `creator_avatar_url`；lobby 继续只使用固定阵营图与 presence。
- 用户显示名缺失时仍回退为 `PokePets`，因此身份字首固定为 `P`，不得显示破图或外部请求错误。

## 验收

静态门禁必须证明业务代码、声明式 Schema、三份原始 migration、正式契约和 OpenAPI 中不存在 `photo_url`、`creator_avatar_url` 或 Telegram userpic URL。Vercel CSP 必须与变更前完全一致。

真实 iPhone Telegram WebView 使用实际带 Telegram 头像的账号重新登录后，五个主页顶部和 Battle 邀请只显示身份字首；Safari 网络记录没有 `t.me/i/userpic` 请求，控制台没有头像 CSP 拒绝。身份 bootstrap 与 Battle 邀请响应逐字段不含头像 URL，真实开发数据库不存在头像列或 JSON 字段。
