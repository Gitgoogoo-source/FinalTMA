# ADR-100：开盒结算画面完整性前置门禁与成功终态降级

- 状态：已接受
- 日期：2026-08-31

## 背景

`api.gacha_open` 原先只校验 70 条链、210 个模板和三档盲盒规则，没有校验当前资源发布、210 条模板映射及缩略图/详情图对象。空库重建后如果没有按 v1→v2 恢复资源登记，数据库仍会扣除 Stars 或消费免费资格、发放藏品并把 operation 写成 `succeeded`，但结果中的两类图片 URL 为 `null`。严格 HTTP 输出契约随后返回 `RESPONSE_INVALID`，operation 查询又重复校验同一无效结果并返回 `INTERNAL_ERROR`，Web 因没有可消费终态而永久停在开盒动画并持续轮询。

资源发布缺失不是动画性能问题，也不能通过放宽正式图片 URL 契约、伪造占位结果、重复执行开盒或把已经成功的资产事务改写为失败来处理。目录发布与应用发布还存在先后窗口，因此数据库、API 和 Web 必须同时兼容旧版本与历史异常 operation。

## 唯一结论

数据库新增只读 `catalog.asset_release_ready()`，固定验证当前指针指向唯一 active release、该 release 恰好映射 210 个 v1 模板，并且每条映射的 active 私有 768px 母版、active 公开 256px 缩略图和 active 公开 768px 详情图均符合当前交付桶。`api.gacha_open` 在读取或消费免费资格、改变余额、保底、holding、图鉴、任务及写入成功结果之前，先以共享表锁稳定目录规则与资源发布，再调用该函数。未就绪时 operation 以 `CATALOG_UNAVAILABLE` 失败，所有玩家资产和业务状态保持零副作用；同 key 重放返回同一失败，不得在资源恢复后以旧 key 补执行。

API 保持开盒成功输出中的两个图片 URL 必填。直接开盒响应若遇到历史 `succeeded` 结果中的空图片 URL，返回可重试 `CATALOG_UNAVAILABLE` 和原 operation ID，不返回不符合契约的伪结果。operation 查询把这一种确定情形规范化为 HTTP 200：`status = succeeded`、`result = null`、`error_code = CATALOG_UNAVAILABLE`；业务成功状态与 presentation 错误码共同形成唯一的画面不可用组合，继续复用已有严格 operation 信封，不扩大首屏契约。其他输出契约错误仍是 `RESPONSE_INVALID` 或 `OPERATION_RESULT_INVALID`，不得被该兼容路径掩盖。

Web 只对携带 operation ID 的网络中断、结果契约错误或 `CATALOG_UNAVAILABLE` 进入恢复。自动查询严格在 1、2、3、5 秒后最多执行四次；四次后仍为 `pending/unknown` 时停止定时器和动画，显示可手动“查看最新结果”的终态界面，不再产生后台轮询。查询得到 `succeeded + unavailable` 时立即退出动画，显示“操作已完成”“奖励已存入藏品”和“画面暂时无法显示”，只提供“查看藏品”和“查看最新结果”。前者读取最新权威藏品，后者只查询原 operation，均不得创建新的 `gacha.open` 或改变资产。真实 URL 存在但图片下载或解码失败的既有“灵契尚未显现 / 再试一次”流程保持不变。

## 发布与可观测性

Vercel production 构建在编译前执行当前 v2 manifest 的 `assets:release status`。当前 v2、历史 v1、产品指针、两批映射或 URL 任一不一致，或者 production 的目录环境变量缺失，构建必须非零失败；本地和 Preview 构建不访问远端目录。API 错误日志增加 operation ID；`RESPONSE_INVALID` 只记录经过结构化验证器生成的 issue path/code，资源画面错误只记录 `presentation_status`，不得记录请求、响应正文、会话或密钥。

项目尚未冻结生产 migration。实现直接修改声明式 `20_catalog.sql`、`40_gacha.sql` 并重新生成原始 baseline，不新增修复 migration。空库重建后仍按 v1→v2 恢复两份冻结 manifest，再执行失效即失败的状态门禁。

## 验收

数据库影响域必须证明资源表全空、指针缺失、映射缺项、对象非 active 和对象规格错误都在任何资格、余额、保底、holding、图鉴、任务和成功 operation 变更前返回 `CATALOG_UNAVAILABLE`；目录完整时单抽、十连、免费资格、付费、保底和同键回放保持原规则。历史成功且 URL 为空的 operation 必须由查询返回 `succeeded + unavailable`，不得返回 500，也不得重复扣款或发奖。

真机验收使用真实 iPhone Telegram 与 Safari Web Inspector。无额外付费场景先验证既有异常 operation 可退出动画、进入藏品或手动重载，并确认最多四次自动查询后停止。只有获得新的明确付费授权后，才执行一次正常开盒，确认唯一 `gacha.open`、HTTP 200、4.7 秒演出、真实结算舞台、藏品/余额/保底一致和零重复轮询。静态检查、数据库查询、浏览器替代页或本地功能测试不能代替该真机结论。
