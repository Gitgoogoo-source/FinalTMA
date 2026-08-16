# ADR-076：顶部资产数值字体与纯整数格式

- 状态：已接受
- 日期：2026-08-17

## 背景

全局顶部资产栏同时展示 Fgems 与 K-coin 可用余额。原实现复用界面通用圆体并通过当前语言的 `Intl.NumberFormat` 加入千位分隔符，数字形态较宽，也会把 `13584` 显示成 `13,584`，与已确认参考图中的窄体数字及完整连续整数不一致。首次采用的 SemiBold `600` 后续又被确认偏粗，因此需要降低一档字重，同时保留同一字体形态与既有几何。

系统字体在 Telegram iOS、Android、Desktop 与普通浏览器之间并不一致。只声明 `DIN Condensed`、`Arial Narrow` 或 `Impact` 会因设备是否安装字体而产生不同字形，不能形成同一套可上线视觉结果；运行时读取 Google Fonts 又会增加第三方网络依赖并超出当前同源资源边界。

## 决策

顶部 Fgems 与 K-coin 的数值唯一使用 Teko Medium `500` 拉丁子集 WOFF2。字体文件固定随 Web 部署从同源 `/assets/fonts/teko-latin-500.woff2` 提供，并在首屏 HTML 中预加载；浏览器不连接 Google Fonts 或其他第三方字体服务。源字体来自 Google Fonts 的 Teko v23，按 SIL Open Font License 1.1 使用，仓库保留完整许可证与来源记录。

`@font-face` 使用独立族名 `Teko Asset Digits`，并以 `unicode-range: U+0030-0039` 把该字形限制在十进制数字。资产值固定为 `20px`、`500`、`0.9` 行高和 `0.01em` 字距，继续使用等宽数字特性；加载省略号与不可用破折号不使用该字体，也不改变既有状态语义。

`TopAssetBar` 的资产格式化只把权威整数值转换为十进制字符串，不再调用语言相关的 `Intl.NumberFormat`。因此 `13584` 固定显示为 `13584`，不插入逗号、空格或其他千位分隔符，也不缩写为 `K`、`M` 或其他单位。该展示转换不计算、截断、四舍五入或改变余额；资产值、刷新、充值入口、数据库权威与业务结算保持原样。

## 不变量

- 字体只作用于共享 `TopAssetBar` 内 Fgems 与 K-coin 的数字，不改变身份、月卡权益、页面正文、弹窗或其他金额展示。
- 两项资产继续读取 `identity.summary.assets.*.available`，前端不计算或决定资产结果。
- 两项资产的图标、按钮宽高、间距、颜色、点击行为、安全区位置和窄屏断点保持不变。
- 字体资源只从当前 Vercel 部署同源读取，不新增浏览器第三方连接、Supabase Data API 或 Storage 访问。
- 完整数值超过当前按钮可见宽度时沿用既有单行裁切保护，不改写、缩写或分组原值。

## 验收

影响域必须通过 Prettier、ESLint、Web TypeScript、架构检查和生产构建；发布前执行全量 `validate:static`。同一部署 SHA 的真实 iPhone Telegram 与 Safari Web Inspector 必须确认字体请求为同源 WOFF2、Fgems 与 K-coin 的计算字体为 `Teko Asset Digits`，示例余额 `13584` 和 `116` 分别连续显示为 `13584` 与 `116`，页面中不存在 `13,584`、`K` 或 `M` 缩写。静态检查、普通浏览器或部署 READY 不能替代真机视觉验收。
