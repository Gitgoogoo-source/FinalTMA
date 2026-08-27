# ADR-088：Telegram 发现页品牌素材与公开信息闭环

- 状态：已接受
- 日期：2026-08-27

## 背景

生产 Bot 已具备 Main Mini App、头像、About、Description、named Mini App 与菜单入口，但 Main Mini App 预览、说明图、可辨识的 Launch Screen 图标、Privacy/Terms 公开页和 Bot 全局命令尚未形成闭环。Telegram 官方当前说明把启用 Main Mini App、上传高质量真实媒体预览和接受 Telegram Stars 支付列为提高 Mini App Store 精选机会的基础条件；精选资格不等同于保证收录。

ADR-086 曾把金龙图限定为 Bot 头像。用户于 2026-08-27 最新裁决改为：本次 Telegram 发现页视觉统一使用独立金龙头像风格，运营主体固定为 `EvoMyPet Team`，公开支持入口固定为 `@EvoMyPetSupport`，支付验收使用普通盲盒单抽的 9 个游戏 Stars 入口。该最新裁决取代 ADR-086 的金龙使用范围限制，不改变游戏内 UI、经济规则或 Telegram Stars 商品档位。

用户于 2026-08-28 提供四张新的真实 iPhone Telegram 页面截图，并裁决以黑色 Rare Mystery Box、Market、Collection、Tasks 取代旧的黑色 Rare Mystery Box、Battle、Market、Tasks 预览组合。黑色 Rare Mystery Box 仍固定为 BotFather 首张展示图。

## 唯一结论

Telegram 发现页使用现有生产 Bot 金龙头像作为唯一品牌来源。仓库保存可追溯的头像副本、一个恰好只含单个 `<path>` 的金龙 Launch Screen SVG、横向 Welcome/Description Picture，以及四张由真实 iPhone Telegram Mini App 页面构成的竖向预览，上传顺序固定为黑色 Rare Mystery Box、Market、Collection、Tasks。预览只允许按原始比例缩放、裁除截图外的桌面背景、增加圆角、色彩框架和文字标题，不得拉伸、生成、替换或伪造游戏界面、资产余额、概率、藏品或交易状态。金龙素材只扩展至 Telegram 发现页、公开 Privacy/Terms 页面和对应上传母版，不替换启动页、分享图、TON manifest、游戏内顶部或导航资源。黑色 Rare Mystery Box 只属于展示素材，不改变付款验收继续使用白色 Standard Mystery Box 9 游戏 Stars 单抽的裁决。

公开页面固定为同一生产域名的 `/privacy.html` 与 `/terms.html`，无需 Telegram 身份、会话、API 或数据库访问。两页以英语发布，运营主体为 `EvoMyPet Team`，支持入口为 `https://t.me/EvoMyPetSupport`，明确区分游戏 Stars 与 Telegram Stars，不声明不存在的自助删除、现金价值、退款权利或支付凭证收集。

Bot 全局命令固定为：

- `/start` — `Open EvoMyPet`
- `/paysupport` — `Get Telegram Stars payment support`
- `/privacy` — `Read the Privacy Policy`
- `/terms` — `Read the Terms of Use`

`/start`、`/privacy` 与 `/terms` 只在经 webhook secret 校验的私聊中回复，并分别带 named Mini App、Privacy 或 Terms 的 URL 按钮。命令支持无后缀形式和当前 Bot 用户名后缀；`/start` 允许 Telegram 追加启动参数但不读取或执行业务动作，其他两项不接受参数。群聊、其他 Bot 后缀、未知命令和额外参数不回复。`/paysupport` 继续完全遵守 ADR-077，不查询订单、不改变资产。所有命令回复失败均返回 `TELEGRAM_API_FAILED`，由 Telegram 重试；命令自身不读写数据库。

BotFather 的 Custom Privacy Policy URL 固定为 `https://final-tma-pi.vercel.app/privacy.html`。Terms 通过 `/terms` 命令和 Privacy 页互链公开。Main Mini App URL、short name、Fullscreen、Same-Origin、Menu Button、About、Description、Botpic 和生产 webhook 均保持既有配置。

## 支付验收边界

普通盲盒单抽价格固定为 9 个游戏 Stars。真机验收先确认该按钮与金额，再触发既有不足余额/充值继续流程。游戏 Stars 可以在用户已明确授权的范围内消耗；任何 Telegram Stars 最终付款仍必须由用户在 Telegram 原生确认页亲自执行。Telegram Stars 充值金额继续由现有商品目录裁决，不得把 9 个游戏 Stars 静默改成 9 Telegram Stars，也不得为本次验收新增支付档位。

## 验收

代码与素材先通过 Prettier、ESLint、API/Web TypeScript、OpenAPI 漂移、架构检查和生产构建，再由 `main` Git Integration 自动部署。相同部署 SHA 必须确认两个公开页面返回 HTML、互链正确、无需会话且不调用 API；真实 Bot 私聊逐项验证四个命令；BotFather 重新打开确认 Custom Privacy URL、命令列表、Welcome Picture、Launch Screen 图标和黑色 Rare Mystery Box、Market、Collection、Tasks 四张 Main Mini App 预览已按固定顺序保存；生产 Bot 资料页显示预览且 Main、named 与菜单入口仍能打开应用。支付只以真实 iPhone Telegram 验证到用户亲自确认的原生付款边界，随后再验证游戏 Stars 到账和白色 Standard Mystery Box 9-Star 单抽；不得以静态代码、BotFather Enabled 或本地页面替代真机证据。

## 关联裁决

本 ADR 补充 ADR-001、ADR-006、ADR-075、ADR-077、ADR-083、ADR-086 与 ADR-087，并只取代 ADR-086 中“金龙图只属于 Bot 头像、不进入 Git 或公开 Web”的范围限制。
