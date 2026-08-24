# EvoMyPet 生产环境验收证据模板

当前 MVP 的钱包与 Mint 验收结果固定为“功能不可见且不运行”：五个主页面没有钱包/Mint 入口或占位，任务页没有钱包/链上分类与任务，启动和恢复不请求对应接口或加载 TON Provider，`/mint/*` 不可达，OpenAPI 不发布钱包、Mint 或 Mint 对账端点且直接请求返回 `API_ROUTE_NOT_FOUND`，Vercel 只存在四项非 Mint Cron。不得执行钱包连接、签名、链上交易、Collection 发布或 Mint 对账来替代这一验收。

每个场景复制一份，所有字段必填；截图和日志只保存引用，不提交敏感值。

```text
场景：
环境：production
Git commit：
Vercel deployment id / status / source SHA：
Migration：填写 `supabase/migrations` 中按文件名排序的三条实际迁移及校验和
OpenAPI / Catalog manifest / Battle checksum：
设备、Telegram 版本、浅色/深色：
开始时间（UTC）：
request_id：
operation_id：
幂等键指纹（不可记录原值）：
账本前值 / 后值：
库存前值 / reservation / 后值：
支付订单 / Telegram charge id（脱敏）：
Battle room / participant / state_version（脱敏）：
Battle ruleset / checksum：
Battle stake / settlement / outbox event（脱敏）：
预期：
实际：
服务端日志引用：
截图引用：
结论：PASS / FAIL
验收人：
```

## 必须覆盖的场景

应用契约与数据库双向不兼容的开发切换必须保存版本对齐证据：活动 Battle、未发布 outbox 与未决 operation 为 0；`main` 的单一完整提交经 Git Integration 自动创建的 Production deployment 为 `READY`，source SHA 等于发布单元 Git commit；远端三条 migration、OpenAPI、Catalog manifest 与 `battle-v1` checksum 均来自同一提交。Vercel Production 在入口开放前保持启用，不需要项目暂停、`503 DEPLOYMENT_PAUSED`、`BLOCKED` deployment、空触发提交或部署后重新暂停的证据。开始验收时 Telegram 入口、webhook 与 Vercel Cron 仍保持关闭，所有受控账号均已关闭旧 Mini App 并从 Telegram 重新加载当前 deployment；应用与数据库已经对齐，且 `/api/health`、受控 API 与运行日志没有 `RESPONSE_INVALID` 后才恢复调度和入口。任一必要证据缺失都不得把切换记为 PASS。

执行 Telegram 登录场景前，先保存入口配置证据：Bot API `getMe.result.username` 必须等于当前环境 Bot，`getMe.result.has_main_web_app` 必须为 `true`，默认菜单按钮必须为 `web_app` 类型并指向当前环境 named Mini App 链接；随后只能从该 Bot 的 Main Mini App、菜单按钮或 named Mini App 链接启动，不得用浏览器直接访问部署 URL 代替 Telegram 真机验收。

- Telegram 登录：首次、再次和并发首次登录；同键同 `initData` 回放且计入用户和 `initData` 限流；同键不同请求拒绝且限流记录提交；名字、姓氏和 username 更新；实际携带 `photo_url` 的签名 `initData` 仍可正常验证，但该字段不进入数据库、身份响应、Battle DTO 或 DOM；无参数默认开盒页；严格大写 TMA 推荐入口；合法 `BTL_` Battle 入口进入游戏页且不创建推荐候选；格式合法但房间无效、取消、接受或过期时继续登录并展示真实不可用状态；其他非空参数在用户和 `initData` 限流记录提交后、建号前拒绝。
- Telegram 边界：签名伪造、机器人、恰好与超过 24 小时、恰好与超过未来 5 分钟；来源第 31 次、用户第 11 次和同 `initData` 第 4 次拒绝且页面不自动重试。
- 身份数据库往返：在无其他请求的窄 UTC 窗口保存 Supabase Data API 日志，完成入口交接的正常登录必须按顺序且只出现 `identity_consume_login_source_rate_limit`、`identity_authenticate` 与事务提交后的 `identity_initial` 三次 RPC，浏览器网络只出现一个认证请求；推荐 `pending` 登录只出现前两次，绑定形成确定终态后再出现一次 `identity_initial`。签名伪造只出现来源限流，代码和运行日志均不得出现 `identity_resolve_session`。`identity.summary` 等单 RPC 玩家读取只出现自身业务 RPC；顶部人工刷新、五分钟前台恢复、业务资产变化、Battle 终局和页面返回均不得调用 `identity_initial`。强制让认证内初始状态读取临时失败时，认证仍返回有效 session 与空 `initial_state`，Web 只命令式重试一次入口状态；稳定会话、封禁和交接错误不得降级。篡改访问令牌任一字符必须返回 `SESSION_REQUIRED` 且没有业务 RPC；合法签名但已替换、过期、封禁或 `pending` 的凭证必须由首个业务 RPC 返回既有稳定错误。Battle 阶段日志的 `auth_ms` 不包含数据库往返，简单 Battle 请求的 `db_rpc_count` 只计算业务 RPC。
- 会话与封禁：15 分钟绝对失效、多个并发请求只恢复一次、恢复后的第二次失效、会话替换不恢复，以及初始和使用中封禁时 DOM、弹窗、导航、查询及迟到结果全部清空。
- 邀请前置交接：成功、老用户静默进入、已有关系、已有充值、自邀请、邀请码无效、邀请人不可用、候选超时、结果未知和 `OPERATION_NOT_FOUND` 原键单次重提；候选仍为 `pending` 时分别使用普通直接入口与合法 `BTL_` 入口重认证，认证必须继续返回同一候选 code、`entry_handoff_state = pending`、`initial_state = null`，全部普通业务 RPC 与支付创建仍返回 `ENTRY_HANDOFF_PENDING`，不得创建第二候选或绕过主页面。并发执行旧会话绑定与新会话认证时，成功或确定拒绝必须同时使请求会话和最终未撤销会话完成，随后新会话可读取 `identity.initial`，Battle 入口在交接完成后继续原邀请流程。老用户场景必须确认后端仍返回 `REFERRAL_OLD_USER`、交接已完成、页面不存在邀请提示，且没有新增候选、邀请关系、绑定操作、奖励或资产变化；其他结果继续显示既定提示；保存候选、两代会话与操作的数据库前后状态。
- 首屏：生产构建打印的闭包必须同时满足 JS `400000 / gzip 125000` 字节、CSS `110000 / gzip 23000` 字节，禁止模块为零且无 Vite 大 chunk 警告；仓库内不得存在共享 UI barrel、其导入或 React Router 依赖。入口在 React 渲染前只能预取已登记的首屏契约，重型 `OperationRegistryRuntimeProvider` 不得进入闭包。该静态结果不能替代真机验收。真实 Telegram 首次登录与默认开盒页必须确认入口、开盒页和首屏契约先加载，认证响应携带的 `initial_state.summary` 写入 `identity.summary` 缓存，`recovery` 只写入当前 session generation 内存；默认开盒页的数据、规则、身份摘要和当前盲盒主图全部就绪后，网络允许动态准备开盒操作 Runtime 与开盒表现 JS/CSS，但不得请求背景图片、业务 API、结果宠物图或其他领域表现，且这些资源不得进入首屏同步闭包。市场、Battle、藏品、任务、转盘、图鉴、充值/VIP 弹窗和其余五类结果 JS/CSS 在对应意图或真实恢复需要前不请求；第一次操作必须立即反馈且只提交一次，开盒首次点击不得出现浅色通用处理页，运行时加载失败不得发送业务 API。`identity.initial` 整体失败保留内存会话并可重试，VIP 和默认开盒摘要分别失败时只关闭自身入口并可局部重试，网络记录不得出现钱包摘要请求。
- 操作选择性订阅：同一 session generation 内先访问交易、游戏、开盒、藏品和任务使五页全部常驻，再分别执行开盒、市场购买或上架、转盘以及未决 operation 冷恢复。Context value 必须始终为同一 Store 实例；命令只消费稳定函数，领域页面只订阅自身 route 阻塞，底部导航、恢复发现与转盘 epoch 只订阅各自单一信号。一个选择信号没有变化时，对应无关消费者不得出现由操作注册中心触发的额外 render commit；operation message、结果校验、活动弹窗或其他 route 阶段变化不得广播全部常驻页面。首次 Runtime 交接期间按钮和导航锁无闪断，水合队列在 Runtime 提交对应 epoch 前不得提前恢复发现；命令只提交一次、恢复只查询原 operation ID、Runtime 只加载一次，网络请求、刷新范围、结果弹窗与数据库终态保持既定结果。Session generation 切换和封禁必须同步清空全部选择信号，旧 Runtime 的迟到发布不得重新锁定界面。
- 原生导航：同一部署 SHA 的 Telegram iOS 与 Android 分别覆盖普通入口、合法 `BTL_` 入口、五个主导航、查询参数 push/replace、图鉴进入与返回、系统历史前进/后退、Telegram BackButton、任务/支付恢复/操作结果跳转和非法路径回正。普通入口首次开盒页和 Battle 入口首次游戏页必须显示 Telegram 原生关闭；五个主导航或其他真实 push 后必须显示原生返回，连续点击逐项恢复上一历史项且不关闭 TMA，回到本次 Web 文档第 `0` 项后恢复关闭。从后退位置重新 push 必须删除原前进分支。查询参数 replace、入口归一化和非法路径回正保留当前历史 index；当前路径、查询和 hash 完全相同时重复点击主导航不生成假历史。刷新、关闭重开和 WebView 重建后当前页成为新根，不读取旧运行历史。路径、查询参数、调用方 history state、页面筛选、选择、滚动和常驻状态必须与目标历史项一致；操作导航锁期间原生返回不得绕过现有锁。导航不调用关闭接口、不新增 API、业务预取、前端持久化、数据库读写或跨源跳转，资源瀑布不得出现 React Router；页面按既有 stale/refresh scope 产生的权威回正与导航本身分开记录。
- 幂等：Web Crypto 生成规范 UUIDv7；UUIDv4、早于 24 小时、晚于当前时间超过 5 分钟的新 key 均在 operation 插入前返回 `IDEMPOTENCY_KEY_INVALID`。同键同请求先回放且不增加准入计数，同键不同请求拒绝；并发同 key 只产生一行。非 Battle 分别验证第 60/61 个每分钟新 key、第 1000/1001 个每日新 key、第 100/101 个最近 24 小时失败和第 20/21 个并发 `pending/unknown` 的边界，命中时零 operation 副作用；Battle 命令继续只受其独立限流。构造带账本、图鉴、权益、市场、任务、支付或 Battle 外键且完成超过 30 天的终态，清理后父 operation 与永久业务事实仍在、`request/result` 已压缩；无引用失败满 7 天删除，无引用成功在满 37 天前保留且满 37 天删除，删除后原 key 不能重新执行。转盘逐项结果随压缩删除；非终态、未确认进化与活动支付/Mint 不清理。每轮压缩和删除各最多 5000 条并使用 `SKIP LOCKED`，`maintenance` 数量与 `job_runs.details` 一致，不得死锁、遗漏新增外键或重复计数。
- 资产业务：开盒、转盘、进化、分解、远征、Battle、任务、邀请和图鉴奖励的并发扣减与重复提交；除进化专用回执外，所有服务端终态弹窗的“确定”“收下”或本地返回网络记录中不得出现结果确认、原操作查询或由按钮触发的权威刷新请求，数据库不得写入确认、已读或展示状态。开盒的“去藏品查看”也不发送请求，“再开一次”只能提交一个新的 `gacha.open`。开盒、转盘、分解和通用结果出现后隐藏、Telegram `deactivated`、刷新、关闭或重进必须直接显示对应首页和最新权威状态，不恢复旧结果，迟到响应也不得重新打开。非进化 `pending`、`unknown` 重进后不得因 Runtime 状态发布重复水合同一 operation snapshot，只查询原 `operation_id` 并保留必要操作锁，控制台不得出现 React maximum update depth；取得终态后只回正权威状态并静默解锁。人为让旧 operation 事务晚于新会话 bootstrap 提交，确认 bootstrap 游标先保持旧值、统一发现随后只返回路由标记、不返回结果内容；所有声明范围必须标记失效，当前页面与全局活动查询成功后推进游标，隐藏页面不发请求且返回后回正，最终资产、库存、保底、任务和 Battle 与数据库一致。转盘结果逐项核对有序奖励、固定扣款、Stars 奖励返入、净变化、里程碑、免费资格、今日次数和最终资产；单转与十连都必须只提交一个 `wheel.spin`，正常停盘落到有序奖励最后一项，构建产物的转盘终态等待不得引用 `Animation.finished`，人为让 Animation 完成信号不收敛时普通模式最迟 2500 毫秒、减少动态效果最迟 860 毫秒仍落到同一最终位置并打开结果弹窗，结果处理前按钮和底部导航持续锁定且无闪断。结果出现时 Safari Web Inspector 必须确认 `.app-shell.operation-dialog-backdrop` 的计算定位为视口级 `fixed`、四边归零且可见，遮罩不得作为 Runtime 后置兄弟进入主壳下方；直接进入任务页时转盘表现资源必须独立包含结果关键帧和当前视口适配，不得依赖市场表现资源先加载。覆盖十连扣 180、返入 140、净 -40，以及 9 次单转合计扣 180、返入 100、净 -80，均不得误报为少扣款。
- 开盒代码特效与结果图片同步：在同一开发 deployment 的真实 iPhone Telegram 中以冷缓存执行单抽和十连；动画流畅度和主观听感必须在 Safari Web Inspector 完全关闭时肉眼、用人耳检查并连续采样，Inspector 只在另一轮独立检查 DOM、属性、音频节点和网络，不得把开启 Inspector 后的异常卡顿归因于产品。四核及以下设备必须创建并运行自定义 Web Audio 节点和 `AudioContext`，同时保持没有演出期 Telegram `HapticFeedback` 事件；五核及以上设备继续同时验收现场合成音与演出触觉。默认开盒页首屏事实就绪后，开盒表现 chunk 必须已通过动态边界准备；首次点击以及结果舞台“再开一次”都只能提交一个新的 `gacha.open`，第一帧直接进入中性黑洞舞台，不得出现浅色通用处理页；前三轮合计 `1840ms` 内不得准备结果图片或挂载结果 DOM；`1840ms` 到 4 秒之间只允许脱离 DOM 的图片读取和异步解码，完整结果 DOM、布局、绘制节点和合成层必须等黑洞到达 4 秒静止临界帧后才挂载。演出 DOM 必须复用一个程序化深黑金色背景和同一个 Canvas/WebGL context；首次激活必须为 `data-astral-startup=warm`，其成立前 WebGL 预热帧必须已经以 `finish()` 完成；Canvas 只能挂入演出既有宿主并按实际尺寸对齐，不得另外显隐一张全屏根层 surface；网络瀑布不得出现效果图片、粒子贴图、视频、音频文件、第三方特效运行时或第二次业务请求。前 4 秒必须按 ADR-067 完成 13 次中性呼吸、弧线粒子吸入和最后 `470ms` 临界频闪，并按 ADR-082 在每轮依次播放一强一弱两次电子心跳；13 组双拍必须随黑洞同步加速，后段不得形成刺耳爆音、独立揭晓撞击或提前泄露结果。最后 `700ms` 才混入真实稀有度并显示冲击环和全屏金光，声音固定为前 `300ms` 完全静音与后 `400ms` 同一套实体扭蛋胶囊“啵啪”弹开声；静音结束后先出现一次圆润、短促而不低沉的气压释放“啵”，紧接一次干净的塑料壳回弹“啪”，两次瞬态必须连成同一次胶囊盖被顶开的动作，并在有声段前约 `105ms` 内收束，最后约 `180ms` 不得保留人工尾音；不得出现电音、铃声、机械弹扣、裂纹扩展、第二次开盒、爆炸、玻璃碎裂、低频重砸、固定音高、旋律或长混响，声音不得随盲盒档次、抽取数量或稀有度变化，五核及以上设备另提供仍按稀有度裁决的冲击触觉，四核及以下设备只省略触觉。单抽唯一详情图或十连初始中央缩略图未完成 `decode()` 时必须冻结在无稀有度临界帧；十连其余九图即使迟于 4 秒也不得延长揭晓门槛。4 秒呼吸结束后挂载的十连成功结果在完全不透明的演出层后方保持 `aria-hidden`、`inert` 和不可交互；中央项按最终效果预绘，其他已解码项必须以近透明状态留在绘制树中完成首次纹理上传，但金光交接首帧仍只显示中央项。结果层从准备到可见必须保持同一绝对定位和根合成层，使用无子图层、无模糊和无混合模式的静态深黑背景，金光交接不得重启中央项、标题、身份或按钮动画。金光结束的第一张结果帧必须同时出现中央主图、身份、标题和按钮，不得先出现左侧图、空中央区或后补主图。计算样式必须证明十连图层没有动画 `filter/blur/brightness`，首帧元素的 `animation-name` 为 `none`，其余已解码图层在首帧后按中心向外顺序每帧最多加入一个且只使用不超过 `80ms` 的不透明度过渡。Safari Web Inspector 只在独立诊断轮次确认 Canvas 在全尺寸 `finish()` 与最多 6 个静态合成帧后从 `data-astral-stage=warming` 进入 `ready`，前四秒创建两条振荡器和一条纹理源，揭晓纹理源在 `300ms` 前没有启动且 `0–300ms` 没有揭晓输出，之后只从固定偏移读取一条确定性纹理源，在 `520ms` 停止，并创建 `480 / 1750 / 3400Hz` 三条胶囊弹开滤波支路，不创建揭晓振荡器、第二次纹理源、延迟或混响节点，揭晓调用没有稀有度参数，并确认结果资源没有额外业务请求或音频文件请求；最终流畅度与听感以关闭 Inspector 后的真实 iPhone Telegram 为准，从第一轮到第十三轮不得出现肉眼可见停顿或刺耳爆音，不要求每个采样间隔都低于 `50ms`。普通设备继续检查 `data-astral-quality=standard`、`520` 条粒子和 `1.25` 像素比上限；四核及以下检查 `low-power`、`320` 条粒子和 `0.75` 上限；减少动态效果检查 `96` 个静态粒子；Canvas 2D 降级分别检查 `180 / 120 / 48` 条粒子。使揭晓门槛图片连续经过首次读取、1 秒和 3 秒重试后最终失败时，中性金光收束后只能显示“灵契尚未显现”和“再试一次”；点击重试只能重新读取同一 operation 的公开 `pet-runtime` 图片，不得新增 `gacha.open`、operation 查询或确认请求，也不得改变 Stars、免费资格、保底、藏品、图鉴、任务和 operation 数量。只有结果舞台“再开一次”才允许创建新的业务结算。
- 开盒统一电子心跳音效：至少在一台浏览器报告四核的真实 iPhone Telegram 中关闭 Safari Web Inspector、设备取消静音并设置可听音量，覆盖不同盲盒档次、不同结果稀有度、单抽、十连、首次开盒和结果舞台“再开一次”。前 `4000ms` 必须在每轮依次听到一次较强主心跳和一次较弱副心跳，13 组双拍随黑洞同步加速，最后短周期自然形成临界连拍；声音必须神秘、紧张但不恐怖，不得出现旋律、语音、街机鼓点、随机音色、独立揭晓撞击、提前揭晓、异常静音或明显音画错位。最后 `700ms` 必须固定为前 `300ms` 完全静音与后 `400ms` 同一套实体扭蛋胶囊“啵啪”弹开声：静音结束后先听到一次圆润、短促而不低沉的气压释放“啵”，紧接一次干净的塑料壳回弹“啪”，两次瞬态必须连成同一次胶囊盖被顶开的动作，并在有声段前约 `105ms` 内收束，最后约 `180ms` 不得保留人工尾音；不得听到电音、铃声、机械弹扣、裂纹扩展、第二次开盒、爆炸、玻璃碎裂、低频重砸、固定音高、旋律、长混响或稀有度差异，不同盲盒、抽取数量和稀有度之间不得听出声音差异。另开一轮 Safari Web Inspector 只确认 `data-astral-breath-periods` 仍为原 13 段、前四秒创建两条振荡器和一条纹理源、揭晓纹理源在 `300ms` 前没有启动且 `0–300ms` 没有揭晓输出，之后只从固定偏移读取一条确定性纹理源、在 `520ms` 停止并创建 `480 / 1750 / 3400Hz` 三条胶囊弹开滤波支路、不创建揭晓振荡器、第二次纹理源、延迟或混响节点、揭晓调用不接收稀有度、网络没有音频文件请求且每次点击只有一个 `gacha.open`；普通浏览器试听、静态检查、开发机试听 WAV 和构建结果都不能代替真实 Telegram 结论。
- 开盒英雄定格视觉：在四核及以下真实 iPhone 上逐帧截图确认 4 秒中性段严格完成 13 次先膨胀再收缩的呼吸，周期依次为 `800 / 580 / 460 / 380 / 330 / 290 / 260 / 230 / 200 / 170 / 130 / 100 / 70ms`，每轮低点和高点仍持续增大，最后四轮在 `470ms` 内形成局部极速临界频闪，最终临界直径约占窄屏宽度一半；外圈粒子必须沿旋转弧线逐步靠近事件视界，暖金吸积流要形成接近参考图的环绕层次而不是直线光束。只有进入已获授权的 0.7 秒真实稀有度揭晓后，才出现以金色为主体的全屏爆光、放射光线和扩散环。单抽结果必须一次性显示 `灵契降临`、藏品名称、稀有度文字、1 至 5 枚星印、NEW、稀有度光环、落点和已解码主图，并在不超过 900ms 内完成唯一一次英雄式定格；十连必须一次性保留全部 10 个图片节点，金光交接首帧只显示预绘中央项且不重启其动画，其余已解码项按中心向外顺序每帧最多加入一个并只使用不超过 `80ms` 的不透明度过渡；只有中央选中项完整显示名称、稀有度和星印，滑动后的新中央项立即显示正确身份。减少动态效果时不播放黑洞呼吸、粒子吸入、金光爆发、落场或定格动画，但最终文字、星印、静态中央光晕与主图完整可见。网络瀑布仍不得新增效果图片、音频文件、第三方运行时或额外业务请求。
- 图鉴读取：保存 `album.get` 的 70 条链、每链 3 个节点以及汇总证据；链类型按 `normal/advanced/top` 分别精确为 40/20/10，节点总数为 210。构造只点亮同链第 2 阶、只点亮同链第 3 阶和点亮后库存归零三种状态，确认页面只使用节点级 `unlocked`，同时显示真实名称、稀有度、阶段和当前拥有总数。
- 图鉴筛选与交互：页面只有“全部、普通链、高级链、顶级链、可领取、未完成”六项并分别得到 70/40/20/10/当前可领取/当前未完成结果；已点亮节点先在图鉴内打开详情，点击“去藏品查看”后才进入藏品页并定位模板；未点亮节点的市场、开盒和第 2/3 阶进化入口分别定位目标模板、可产出稀有度的盲盒和同链上一阶材料，市场无在售与材料库存为 0 均展示真实空状态。
- 图鉴领取与恢复：普通链、高级链、顶级链分别验证 100/300/800 Gems；点击礼物盒立即显示领取中且禁止重复点击。并发不同幂等键、同键回放、同键异请求、响应丢失、刷新全屏图鉴和查询原操作后，奖励最多到账一次，结果弹窗显示真实链名和奖励且不显示 operation ID，`album.get`、顶部 Gems 和礼物盒最终一致。
- 表现模块失败：分别阻断开盒、进化、分解、市场、转盘、图鉴以及充值/VIP 的首次专用 chunk 或 CSS；操作反馈必须立即出现且无空白、FOUC、层级或安全区变化。业务请求已经发出时，重试按钮只能重新加载表现模块，网络记录和数据库证明没有第二次提交；尚未发出请求的契约模块失败必须明确失败且没有 `unknown` operation。恢复网络后原 operation 状态、幂等锁和权威结果保持正确。
- 图鉴无障碍：仅用键盘完成返回、六筛选、210 个节点、详情关闭、三个获取入口和礼物盒领取；弹窗打开后焦点进入，Escape 或关闭按钮退出后焦点回原节点，读屏可读出节点名称、阶段、稀有度、点亮状态、当前数量及礼物盒状态，状态不只依赖颜色。
- 市场：购买页只展示当前存在有效供给的正式模板，最多处理 210 条模板汇总，可买数量排除本人和 banned 卖家；首次上架、同模板追加、已有 9 种时第 10 种成功、已有 10 种时第 11 种拒绝且同模板追加成功。成功上架计数固定按 UTC 自然日 200 次与账号生命周期 20,000 次裁决：验证第 200 次成功、第 201 次返回 `MARKET_DAILY_LISTING_LIMIT` 且无新增 operation/listing/reservation，UTC 跨日后每日归零但生命周期不变；第 20,000 次成功、第 20,001 次及后续跨日均返回 `MARKET_LIFETIME_LISTING_LIMIT`，两项同时用尽时生命周期错误优先。相同 key 回放不计数，同键异请求拒绝不计数；并发争抢最后一次只允许一笔成功；模板、数量、库存和十种模板失败不计数；下架和成交不增减。出售页固定显示“今日剩余 N / 200 · 累计 M / 20,000”，任一剩余为零立即禁用，服务端并发拒绝后刷新权威配额。相同部署 SHA 必须在真实 Telegram iOS 与 Android 至少两种不同竖屏高度中确认出售页无需纵向滚动即可看到资产栏、共享页签、选中藏品、双行缩略图、价格摘要、数量、预计结算、配额和完整确认按钮；调试器必须证明确认按钮边界完全包含在出售表单内、按钮底边小于底部导航顶边，视口与安全区变化后仍成立。管理读取最多处理本人 10 条卖家模板汇总，卡片只显示藏品信息、`出售中 ×N`、官方单价和下架按钮，不存在出售中/总价值/预计到账汇总卡、累计已售、部分成交或管理页预计结算字段；出售确认页预计结算保持不变。上架 7 个并成交 1 个后，同一管理快照显示 `出售中 ×6` 且顶部新增 `已售出 ×1` 的红色 SOLD 卡片；同模板不同交易各生成一张，单笔交易跨同卖家多条挂单只生成一张聚合事件，全部售罄后当前卡片消失而 SOLD 保留。待展示 SOLD 非空时“管理”页签显示红点，点击页签不清除；多张提醒逐条隐藏时红点保留，最后一张隐藏时同步消失。点击整张 SOLD 卡片后必须立即出现 12 枚大型立体 Stars，金币在顶部资产栏至第三张 SOLD 卡片的上半屏分散且不显示运动轨迹，再汇聚到 Stars 胶囊；卡片在点击 600ms 后隐藏，装饰动画约 900ms 结束，动画层不拦截触摸，Stars 余额始终不变，全程没有网络写请求且不显示领取或服务端文案，重开仍隐藏；关闭 Mini App 期间的新成交重开后出现；首次设备基线、清缓存、换设备不补发旧成交；切换账号不串数据；可见交易页 10 秒内发现成交并显示红点，隐藏或离开交易页后停止轮询。真实 RPC 覆盖部分售出、全部售罄、多卖家 FIFO、下架、购买/下架并发、同键回放、同键异请求拒绝和 `normal → banned` 即时排除；任一失败事务的挂单、reservation、库存、余额、成交事件、上架计数与两级汇总共同回滚。按用户和模板全部下架与成交并发时只释放最终剩余 reservation，原键回放及新键重试无有效挂单均幂等成功且不重复释放；买家与成交提醒均不含卖家之外的身份。两项市场汇总不变量新增数量均为 0；owner 重建函数无应用角色权限；应用角色不能直接读取或修改配额表、调用配额 helper。
- 市场性能：在上线前验收库事务内保持当前在售状态不变，增加 100,000 条已售罄或已取消历史挂单前后，`market.bootstrap`、`market.template` 和 `market.my_listings` 的保留字段完全一致。三条 `EXPLAIN (ANALYZE, BUFFERS)` 只能访问两级汇总主键、目录和最多 100 条 `(seller_id, sequence)` 成交游标，不得扫描 `market.listings`、`market.trade_details` 或聚合无游标成交历史；保存修改前后中位耗时、shared buffers、购买/上架/下架事务耗时与死锁/超时计数，读取必须下降且写路径不得新增死锁或超时。
- Stars 充值与 Telegram Stars 支付：提交 Telegram Stars 前关闭立即取消且可重新创建，创建请求迟到不得打开 invoice，`processing/paid` 禁止关闭并在重进后恢复，同 charge 的相同或不同 update 重投只到账一次，取消/失败/过期与成功回调乱序时真实扣款仍唯一到账，invoice 创建失败不遗留开放操作，终态后无冷却立即再充值。开盒充值到账后只有创建该订单的当前 TMA 运行内存仍绑定同一订单 ID 时才打开底部确认弹窗：动态标题与当前盲盒一致，只显示简短的单抽／十连实际消耗，右上角关闭不产生 `gacha.open`，点击“确认开盒”只产生一次新的 `gacha.open`，页面不得出现充值恢复或后端重新确认规则文案。关闭或重新进入 TMA 后，即使 `topup.bootstrap` 返回带开盒 intent 的历史 `delivered` 订单，也必须直接显示常规首页，不导航、不打开确认或结果弹窗、不创建 `gacha.open`；Stars、藏品、账本与既有 operation 保持数据库权威值。同时覆盖金额、订单归属、幂等键篡改、退款、VIP 既有购买流程，以及 `battle_create`、`battle_matchmaking`、`battle_accept` 充值后只恢复最新确认界面且绝不自动创建、入队或接受。`battle_create` 与 `battle_matchmaking` 补差在本人已有 `preparing_share/waiting/lobby/active` 任一参与事实时统一返回 `BATTLE_ALREADY_PARTICIPATING` 且不创建订单。支付助手必须在真实 Bot 私聊中分别向 `/paysupport` 与 `/paysupport@EvoMyPet_bot` 回复默认英语 `Payment support: https://t.me/EvoMyPetSupport`；普通文本与群聊命令不回复，`sendMessage` 失败时 webhook 必须返回非 2xx 以便 Telegram 重试，且全程不查订单、不写数据库、不变更资产；该命令验收不得实际支付 Telegram Stars。
- TON/Mint 休眠：顶部、藏品、任务、Web 路由、启动预取、前端恢复和 Vercel Cron 均不存在可达入口；OpenAPI 不含钱包、Mint 与 Mint 对账路径，逐个直接请求均返回 `API_ROUTE_NOT_FOUND`；不执行链上场景。
- Cron：Vercel job 的同时触发、重复触发、运行租约、漏跑追赶、失败记录和手工重跑；`cleanup-catalog-assets` 还需验证最多领取 500 个对象、重复/并发领取不重删、过期租约恢复、Storage API 部分失败回写、90 天边界、当前引用和回滚锁保护、私有桶零删除。Supabase `battle-tick-v1` 在 migration 提交后独立 `pg_reload_conf()`，并以同一 jobid 至少两个连续自然周期证明每秒触发，保存 runid、起止时间、状态和返回摘要；验证 `battle.tick_health()`、advisory lock、`SKIP LOCKED` 分批、deadline 追赶和 pg_net 唤醒。`BATTLE_TICK_UNHEALTHY`/`BATTLE_TICK_RUN_FAILED` 必须验证失败优先、首次与最近失败保留、来源 job 与当前 job 区分、稳定健康后自动关闭、关闭后新失败使用新历史行，以及更新或关闭不增加 `processed_count`；真实历史告警的关闭必须由自然 `monitor-invariants` 完成，关闭后重新打开只允许在回滚事务内重放现存真实失败窗口。7 天运行明细保留及每日最多 100000 条清理保持不变；禁止手工调用 tick、制造失败、人工关闭或删除告警代替自然调度与恢复证据。
- 一致性：余额账本、库存预留、风险限制、服务器结果覆盖前端临时状态。
- 体验：所有资产操作在 API 返回前立即反馈；普通页面不下载或初始化 TON Provider；主导航不被无关操作锁定。
- 主导航页面保活：交易、游戏、开盒、藏品和任务分别首次进入一次，确认页签、筛选、选择、滚动位置和未提交界面状态在连续切换后保持。页面隐藏后，除切页前已经开始且允许完成的读取、Battle 可见性收尾和市场成交提醒收尾外，网络记录不得新增该隐藏页面的 API、模块、图片或其他页面专属资源请求；业务 `refreshScopes` 必须标记所有匹配缓存失效，但只立即读取当前页面与全局活动查询。20 秒内返回未失效页面不得读取；超过 React Query 的 20 秒 `staleTime` 或缓存已失效时，返回后每个查询键最多回正一次并先显示缓存。强制让该回正失败时，已有内容不得清空，DOM 只显示非阻塞“内容暂未更新”和“重新加载”，不得显示原始错误、服务器、请求或后端处理信息；重试成功后提示消失并展示数据库权威状态。首次无缓存失败继续使用领域初始错误界面。交易页只在页面可见时每 10 秒读取本人挂售与成交游标，购买、出售和管理页签共享该轮询；进入、重新可见和网络恢复时立即读取，隐藏或离开交易页即停止。页面隐藏、Telegram deactivated、`pagehide` 或离开游戏页必须立即结束当前 lease、中止在途 heartbeat、停止 waiting/lobby 心跳和 Battle UI 轮询并尽力 offline；返回时立即 REST 回正并取得数据库认可的新 lease。若数据库已经进入 `lobby_countdown`，这些生命周期动作只改变 Presence，不得取消、暂停、延后或重置已锁定的开战截止时间；进入 active 战斗后 presence 心跳必须停止。图鉴返回时恢复原主页面；顶部资产、支付和统一操作恢复跨主导航保持活动，顶部人工刷新只请求 `identity.summary` 和 `vip.get`。后台不足五分钟恢复时不请求普通页面，Battle 仍执行自身可见性回正，交易页按成交提醒规则立即同步；达到五分钟时只静默刷新 `identity.summary`、VIP/钱包活动查询与当前路由查询。人工刷新、前台恢复、业务范围、Battle 终局和页面返回的网络记录都不得出现 `identity.initial`。Session generation 改变或封禁后旧页面、查询缓存、恢复快照和迟到结果不得恢复，按内部用户隔离的 SOLD 本地收件箱和“管理”红点不得串到新身份。
- Telegram 容器手势：在 Telegram iOS 与 Android 的“交易 / 游戏 / 开盒 / 藏品 / 任务”五个主导航页及可滚动弹窗中，从内容区域向下滑动不会最小化或关闭 Mini App，页面纵向滚动保持可用；从 Telegram 标题栏执行最小化或关闭仍然有效。
- 全局顶部资产栏：五个主页只出现同一个资产栏；Gems 固定显示绿色切面宝石图片，Stars 固定显示紫色星星图片且星星轮廓、朝向和比例与已确认参考图一致，两枚 `64px × 64px` 透明 PNG 均按 `20px × 20px` 显示，按钮内只保留图标与数值；两项余额数值均使用 Teko Medium `500` 窄体数字并显示完整十进制整数，不出现逗号、空格、其他千位分隔符或 `K`、`M` 缩写；分别记录 Telegram iOS、Android、Desktop 与 Web 在原生全屏成功和不支持回退时的截图，确认设备安全区、内容安全区、视口与方向变化后，返回、关闭和更多控件始终位于资产栏上方且不重叠。
- 藏品图片：私有桶永久保存 210 张当前母版和全部历史母版，公开桶当前批次恰好映射 420 个 v2 WebP；完整 URL、模板、对象键、SHA-256、尺寸和字节数与 Git 清单一致，响应缓存同时含 `public`、`max-age=31536000` 和 `immutable`，并由内容哈希键与禁止覆盖保证地址不可变；Vercel 构建不含宠物母版或运行时 WebP。受控命令必须在发布、回滚、清理共用的耐久租约内复核 630 个远端对象及缓存头后切换；并发清理只能跳过，旧 fence 不能提交。数据库 operation 结果不得出现图片 URL；新请求、幂等回放和恢复读取按模板 ID 注入当前 URL，已经打开且未刷新的页面允许保留内存旧 URL。v1 旧批次保持 90 天且受回滚锁保护。真实 iPhone Telegram 冷缓存连续选择当前页藏品时，名称、数值、选中框和正确模板的 256px 主图预览必须同帧切换，768px 详情图下载和解码期间不得出现空主图或上一模板，解码成功后只原位替换一次；A→B→C 快速选择时，A/B 的迟到下载、解码、失败和就绪不得覆盖 C 或改变 C 的操作就绪状态。当前详情就绪后，Safari 网络瀑布只能以单并发、低优先级读取当前可见 4×2 页的其他详情图；横向换页后只继续新当前页，离开藏品页或隐藏文档后除已开始的一张外不得新增藏品详情图读取，一次 Web 运行期不得主动准备全部 210 张。预热失败不自动重试，随后主动选择仍只在首次、1 秒和 3 秒执行正式读取；全部失败后固定布局显示 Vercel 统一宠物剪影，DOM 不出现服务器、Supabase、请求或资源故障文案。网络证据确认浏览器只对公开桶发图片 GET，不访问 Supabase Postgres、RPC、Auth 或其他 Data API；开盒单抽与十连结果仍保持整批图片解码后一次显现。
- 藏品详情身份行：在同一开发 deployment 的真实 iPhone Telegram 中分别选择普通、稀有、史诗、传说和神话藏品，名称区域只显示藏品名称，名称下方及藏品大图上方不得出现稀有度文案；数值行固定显示“进化阶段｜战斗力数值 · 稀有度”，稀有度必须紧跟战斗力数值并使用当前语言，五档最长文案均不得换行、截断、挤压战斗力或与主图重叠。Safari Web Inspector 必须确认 `.inventory-title-copy` 中不存在 `.inventory-title-rarity`，`.inventory-metric.power` 的无障碍名称同时包含战斗力与稀有度，且可见 `.inventory-metric-inline-rarity` 位于战斗力数值之后；切换模板不得新增 API 请求或改变阶段、战斗力和稀有度数据。
- 藏品操作栏：在同一真实 iPhone Telegram 藏品页分别打开 1、2、3 阶藏品，并从任务页跳转定位进化和分解入口；“进化、分解、出售”始终同排三等宽、同高且单个触控高度不低于 44px。Safari Web Inspector 必须确认 `.inventory-action-grid` 为三列等分，三个 `.inventory-action-target` 宽度一致，每个目标中的可见 `.button` 宽高填满目标；聚焦、图片未就绪、最终形态、操作阻塞和可用状态切换均不得使分解或出售按文字内容收缩，也不得改变按钮业务资格或新增请求。
- 藏品技能条：在同一真实 iPhone Telegram 藏品页连续点选至少一只 1 阶、1 只 2 阶和 1 只 3 阶宠物，每次切换后 Safari DOM 中当前 `.inventory-hero-art` 必须恰好只有 1 个 `.inventory-skill-rail`，`.inventory-skill-tab` 数量必须依次等于该模板实际的 2、3、4 个技能且永不超过 4。A→B→C 快速切换、返回已访问的藏品页及重新打开 Mini App 后都不得保留上一模板的技能节点，不得出现重叠、占位或第五条彩色条；默认选中当前模板第一个技能，切换其他彩色条后可见摘要只显示完整技能名称，不得渲染分隔线、伤害数值或任何伤害属性标签；同一技能条节点的 `aria-label` 必须继续包含技能名与伤害数值。
- 目录重建门禁：空库 migration 完成后按 v1→v2 顺序只使用两份 Git manifest 执行 `publish`，不得使用 `bootstrap`、重新上传或手工写表。数据库必须为 1050 个 active 对象登记、v1 retired、v2 active、两批各 210 个映射、revision=2 且 `catalog.asset_mutation_runs` 无 `running`；`pnpm assets:release status` 必须输出 `status: "ready"`、当前 v2 checksum/release/revision、70/210/3/5 和历史 v1 摘要。缺失发布、指针漂移、manifest 漂移、URL 漂移或历史 v1 不可读都必须非零退出，不能进入 HTTP 或真机验收。
- 目录 pointer/release：`GET /api/catalog` 每次只返回标准信封中的 v1 checksum、正整数 revision 和当前 release key，固定 `Cache-Control: no-store` 且 request ID 独立。对应 release raw JSON 精确为 70 条链、210 个模板、3 个箱子、5 个充值档位且不含 revision；成功头固定为浏览器与 Vercel CDN 一年缓存，没有项目级 `x-request-id`、`Authorization`、`Set-Cookie` 或 `Vary: *`，响应小于 10 MB。无效 checksum、staging、缺失映射和不可用运行时对象统一为未缓存 `CATALOG_UNAVAILABLE`。A→B 后 pointer 指向 B 而 A 内容逐字节不变；B→A 后 revision 递增而 A 继续复用。首次无快照失败使用既有初始错误，已有快照时新 release 失败不清空页面，人工重试只执行一次 pointer→release；真实 Telegram 网络瀑布为一个动态小 pointer 和一个浏览器/CDN 可复用 release。

## Battle 验收夹具生产封锁

数据库从空重建后先确认 `admin.database_identity` 与 `admin.environment_controls` 均为空，`PUBLIC`、`anon`、`authenticated`、`service_role` 无 schema usage、表权限和函数 execute，Data API/OpenAPI/GraphQL 不发现 `admin` 对象。owner 只把数据库一次性绑定为 `production / ebewtjerusxcioegpzjd`，不得创建 enable 记录。随后必须证明 `admin.configure_battle_fixture_gate` 对 `production` 拒绝，`admin.reconcile_battle_fixture` 在门禁关闭时拒绝，且 Stars、holding、ledger、ownership、binding 与 run audit 保持调用前状态。

生产不执行夹具正向、回放、no-op 或角色重绑定，不创建夹具账号或资产。既有上线前夹具验收只保留在历史证据中，不能在生产 identity 下复用。

## Battle 第 21 章验收

以下证据必须来自真实 Telegram、真实 Vercel、真实 Supabase 与真实 Ably；静态门禁不能替代：

- Telegram prepared message 创建阶段继续验证同一 room 的 60 秒未知结果恢复、超时作废与退款；该服务端路径不得与已经进入 `waiting` 后的 `shareMessage` callback 混淆。`shareMessageSent`/成功 callback 使用已有真机发送证据；waiting 分享没有平台规定的 no-callback deadline。
- 规则与页面：`battle-v1` checksum 与正式 JSON、数据库种子、API 摘要一致；Catalog v1 仍为 70 链/210 模板且 release checksum 不变；数据库中 1/2/3 阶各 70 个模板、有效技能分别为 140/210/280 且总数为 630；游戏页完整覆盖第 21 章八种页面状态，构建和运行资源不含 Phaser 或客户端战斗模拟器。
- 队伍候选加载：从 Battle 首页进入三槽队伍选择，以及从有效邀请直接进入接受者三槽队伍选择时，`GET /api/battle/team-options` 首次响应完成前只显示“正在读取本人可用藏品”，两个确定动作保持禁用，DOM 不得出现“没有符合条件的可用藏品”；响应完成且当前筛选确实没有可见项后才显示该空状态。使用真实 iPhone Telegram 与 Safari Web Inspector 同时保存首帧 DOM、请求 pending 窗口和响应后藏品卡片或真实空状态证据。
- 分层运行时：生产 build 输出 Battle 增量核心 JS 原始不超过 `160000` 字节、gzip 不超过 `45000` 字节，CSS 原始不超过 `45000` 字节、gzip 不超过 `9000` 字节，静态闭包中的 Ably、重特效播放器和轨迹 CSS 为零，动态 preload 映射中的应用入口 JS 为零。相同 deployment SHA 的 Telegram iOS/Android 网络瀑布分别证明：首次 `home` 核心不下载两类运行时；明确非省流量 4G、可见、在线、Telegram active 的稳定首页只在 idle 后准备；未知/受限网络、省流量、隐藏和 deactivated 不自动准备；非首页权威状态与触摸、指针、键盘意图立即准备且页面与业务动作不等待；第一次玩家意图后入口 Resource Timing 仍只有一次 `script` 记录，不得新增 `link` 或 `modulepreload` 入口请求。
- 服务器错误不可见：在八种 Battle 页面分别覆盖查询失败、命令拒绝、响应丢失、协调器抑制、deadline 回正、Ably 失效与前后台切换；网络证据可保存错误码，但 DOM 不得出现原始 `Error.message`、错误码、`battle-feedback`、通用错误浮层、Toast、Alert 或“重新读取”按钮。用户只看到游戏页面及其行内状态；终态三域回正失败时按 1 秒、2 秒、5 秒、此后每 5 秒静默恢复，离开 `/game` 停止，返回立即继续。
- 隐私：按唯一清单分别保存七种严格 DTO：`BattleChallengeCardDto`、`BattleInvitePreviewDto`、`BattleLobbyDto`、`BattleSelfTeamDto`、`BattleOpponentTeamDto`、`BattleActionEventDto`、`BattleRoomSnapshotDto`；逐字段证明禁止信息不在 JSON、HTML、Ably、日志和分析事件中。挑战卡/接受预览只返回创建者展示名称，Web 只计算名称字首；三者 JSON 和 DOM 均不返回或加载双方真实头像，lobby 只使用固定仓库 WebP/中性图标。动作事件不返回 seed、roll、公式中间值、operation ID 或对手精确生命；接受后对手生命百分比与已执行技能严格符合第 21.7 节。
- 分享与接受：用户私聊、普通群、超级群、跨群转发、Bot 不在群、Bot 会话禁止、频道禁止、创建者本人严格 `self` 且服务端禁止；有效邀请直接显示队伍选择，没有前置状态页。创建者在线与离线均可接受，离线固定展示“离线 · 仍可接受”。两个普通接受者与一个竞争账号同时接受时只有首个事务成功，失败者余额和 inventory 完全不变。
- 公开匹配：20/100/500 三档分别验证只选择同规则同档 `public_match/waiting` 候选，交叉档位并发永不互配；有多个合格候选时保存随机候选证据，无候选时只创建一个 120 秒房。点击匹配的同一事务完成 Stars lock、三份 reservation 与加入或建房；匹配成功固定直接进入不可撤销的 3 秒 `lobby_countdown` 且没有接受确认，创建者在匹配前离线、匹配后离开或断网均不能阻止、取消或重置倒计时。主动取消、恰好 120 秒、超过 120 秒、取消/加入、超时/加入、同键回放与响应丢失逐项证明原额退款、释放、零 settlement、最多一个 opponent，好友房与公开房双向不可加入。
- 分享反馈生命周期：同一 Telegram Mini App 会话中，房间 A 打开分享面板后，通过正常入口终结并创建房间 B；房间 B 未执行自己的分享动作前不得显示房间 A 的任何反馈。房间切换、终态退出和离开再进入 `/game` 的隔离使用 V09 真实证据；页面重载、重新认证及自然迟到 callback 只在真实发生时补充，不倒推为已验证。旧反馈不得覆盖新房间，本地即时反馈不得触发资产刷新或被记录为业务成功。
- 原生分享返回 Presence：在真实 Telegram iOS 创建者 `waiting` 页面分别完成一次成功发送和一次关闭面板，并记录完成信号在页面恢复可见之前或之后到达的实际顺序；Safari Web Inspector 证明 callback 或 `shareMessageSent/shareMessageFailed` 到达后，即使该次没有 `activated` 且 `Telegram.WebApp.isActive` 仍短暂为 `false`，当前有效分享尝试只触发一次 room REST 回正并恢复 5 秒 heartbeat。Supabase 在 10 秒在线窗口内保持创建者在线：实际收到 `deactivated` 时必须使用数据库认可的新 lifecycle version、UUID lease 与从 1 递增的 command sequence，旧 lease 的迟到 heartbeat/offline 为 no-op；只有 `blur` 且原 lease 仍 active 时必须保持同 version/lease 并继续递增 command sequence。分享结果仍不写入房间、资产或 operation，切换 room/generation 后的待恢复或迟到完成信号不得恢复 presence。
- 分享结果分类：`USER_DECLINED` 或 callback 明确返回未发送属于可重试的本地取消；`shareMessageSent` 或成功 callback 为发送成功；`MESSAGE_SEND_FAILED` 或 Telegram 官方等价明确失败事件显示既定失败/重试反馈，证据状态为 `PLATFORM_CONDITIONAL`，不得通过测试 API、mock、故障注入、断网或 Bot/群权限篡改制造 PASS。Telegram 官方 `UNKNOWN_ERROR` 是明确失败事件，不是 no-callback `unknown`。
- waiting 分享 no-callback `unknown` 固定为 `NOT_APPLICABLE_BY_PLATFORM_CONTRACT`：Telegram 没有规定固定 deadline，项目不得新增超时推断或用户可见 unknown。Prepared message 创建阶段的 60 秒恢复、超时作废、退款、幂等和一致性继续按独立服务端路径验收。
- Battle 并发接受页面归属：三个真实账号对同一等待房间同时执行最终接受，数据库只允许一个 `succeeded` operation、一个 opponent、两份 stake 和双方各三份 reservation；唯一赢家的 HTTP 200 与 current-room 必须进入 lobby，其他两端各自保持原资产，网络层返回 HTTP 409 / `BATTLE_ROOM_ALREADY_ACCEPTED` 后页面静默回正且不得显示服务器错误弹窗。随后对赢家执行邀请刷新、room 刷新、同键回放、响应乱序、页面重新可见、离开重进和重新认证，均不得把赢家覆盖为冲突页。房间在 lobby 且尚无 turn 时执行 invariant scan，`BATTLE_ROOM_STATE_MISMATCH` 必须为 0；终态后资产、stake、reservation、outbox、开放 operation 和 violation 全部回正。
- lobby：首位接受后 snapshot 为 `lobby_waiting/lobby_countdown`、双方 participant 为 `lobby` 且没有 turn 1；在 `lobby_waiting` 验证双方 5 秒心跳、10 秒在线判定、89 秒重连、90 秒终结、创建者接受前离线窗口重置和 5 分钟总时限。双方同时在线且数据库原子写入同一 3 秒截止时间后即形成不可撤销参战锁定；随后任一方离页、离线、后台、关闭、lease 结束、刷新或重新认证均不得改变截止时间或取消房间，到期不再次要求在线并且只产生一个 turn 1、一个 `battle_started` event 和一份对应 Outbox。仅 `lobby_waiting` 的正常取消或到期执行双方原额退款、六个 reservation 释放、手续费为 0。
- presence 乱序：分别交换同 lease heartbeat/offline 到达顺序，覆盖隐藏时在途 heartbeat、offline 未送达、重新可见、Telegram 重新激活、离开再返回 `/game`、页面重载、重新认证、重复命令和旧 lease 重放。新 lease 接管后，旧请求必须数据库语义 no-op；在 `lobby_waiting` 不得错误延长 90 秒或 5 分钟窗口，在 `lobby_countdown` 期间任何新旧 lease 或命令都不得改变已锁定的 3 秒截止时间、房间状态、event/outbox 或资产。
- lobby 永久不变量：在真实事务 room-first 锁边界逐项破坏 participant 数量/归属、stake 金额/归属/lock ledger、每方三份快照与唯一 active、六个 reservation、ruleset/checksum/deadline/seed 启动条件；advance 与 monitor 都必须复用同一幂等安全作废，不创建 turn 1。接受事务持锁的中间态不得被 monitor 作废。
- lobby UI：`lobby_waiting` 左红右蓝使用固定仓库正方形 WebP，不使用真实头像；在线同时显示彩色图片、状态点和“已进入房间”，离线显示中性用户图标、文字及权威重连剩余。进入 `lobby_countdown` 后立即切换为覆盖顶部、底部导航和所有按钮的全屏 3 秒红蓝倒计时专页，明确显示“倒计时已锁定，离开不会取消战斗”，产品内不存在可产生取消效果的动作；颜色不是唯一状态信息，`aria-live` 与 reduced-motion 生效。
- 资产与库存：三个入场档逐一核对双方 lock、胜者到账、平台手续费、败者、平局退款、`voided` 退款；重复创建、接受、取消、到期、结算和恢复不重复改变资产。prepared-share 明确失败的 `voided` 必须是一份 stake refunded、三份 reservation released、零 settlement；`cancelled/expired` 全量退款释放；lobby/战斗不变量 `voided` 保留安全 settlement、审计与 violation，monitor 不误报也不漏报。Battle reservation 与出售、成交、分解、进化、远征、Mint 逐一竞争，同模板额外可用数量仍可操作。
- heartbeat/offline 刷新：普通续租和非终态 online/offline 只应用 room snapshot，网络记录不得出现每 5 秒 assets/inventory 请求；请求内跨过 `lobby_waiting` 的 90 秒或 5 分钟边界时，终态响应、响应丢失后的重新可见回正及相关错误必须一次消费契约 `battle + assets + inventory`，顶部 Stars 与 `inventory.battling` 及时回正。请求跨过已锁定的 3 秒截止时间时只能恢复权威 active room，不得产生取消、退款或重新倒计时。
- 阶段技能：全量证明四技能候选池按 `(power, 原始位置)` 排序，同链技能满足 2/3/4 前缀继承、位置连续、元素一致且无重复；L06、L13 的十个 1 阶模板允许没有 100% 命中技能。`team-options`、房间快照、API 和 DOM 只出现实际拥有的 2/3/4 个技能，不含 `null`、锁定槽位、占位按钮或隐藏字段；三技能操作区最后一个按钮横跨两列。受控 API 与 Vercel 运行日志中的 `RESPONSE_INVALID` 必须为 0，禁止用新应用读取旧四技能数据库或用旧应用读取新 2/3/4 技能数据库完成验收。
- 回合：逐项证明创建者更快、接受者更快、同速创建者先手，换宠不重算先手；非行动者固定返回 `BATTLE_NOT_YOUR_TURN`；双方各自拥有完整 15 秒；普通超时使用当前宠物技能位置 1；主动换宠只切换并结束行动；击倒后有替补时一次提交换宠反击，超时按首个存活槽位与技能位置 1；无替补立即终局；第 20 回合必须完成 ordinal 1 与 2 后裁决。五属性 1.50/0.75/1.00、十技能命中边界和实际技能归属继续逐项保存 snapshot 与私有审计引用；对 1/2 阶宠物提交未拥有位置必须返回 `BATTLE_ACTION_INVALID`、零 action 写入，原幂等键重放结果不变。
- 实时与恢复：Ably capability 为 subscribe-only，消息只有四个失效字段；重复、乱序和迟到消息不覆盖高 `state_version`。真实邀请接受必须证明授权上下文从 `invite:<room_id>` 切换为 `room:<room_id>`，新旧 token 的唯一用户频道与 `clientId` 不变，旧 invite 订阅移除、新 room 订阅附加；切换和随后至少一次五分钟自动刷新均保持 `connected`，Console 不出现 `token_refresh_invalid`、401、`connection_unavailable` 或 `channel_attach_failed`。页面持续可见时以 `after_action_sequence` 每次补齐最多 16 条动作事件；初次进入、刷新、隐藏返回和重新认证把游标初始化为最新 sequence，不补播历史。主动断开 Ably 后按第 21 章 1—2 秒节奏 REST 回正；Ably 保持 connected 但通知丢失、deadline 首次 REST 读取失败或仍返回同一 deadline 时，页面在 `00:00` 后按 active 1 秒、其他活动状态 2 秒继续静默回正，直到权威状态前进或终结。当前会话持有未终局 room 时，bootstrap 的空 participation 不得直接使页面回首页。Vercel 重启、pg_net 单次失败、cron 短暂停止后继续同一 deadline、outbox 和 settlement。
- 动画：本人点击攻击后立即播放施法、移动或弹道，服务端事件前不显示命中、伤害、生命变化或死亡；对手动作从权威事件完整播放。换宠反击点选替补后，本人战场在同一次交互刷新中显示该宠物的大图、名称、生命和槽位高亮，再开放其技能选择；此时网络记录没有 action 请求，对手端没有换入变化，点击技能后恰好提交一次 `replace_attack`，对手只在服务端成功结算后显示权威换入结果。动作按 sequence 串行排队，上一动画期间下一行动者的倒计时与按钮保持可操作，其提交立即进入服务端；动画层不得拦截指针。reduced-motion 按同一事件顺序无动画应用结果。
- 运行时失败降级：快速技能点击的 action 请求与重表现 chunk 下载并行，下载期间只有行内“战斗准备中”且 15 秒倒计时继续；动态模块、CSS 和 Web Animations 分别失败时不重提 action，权威事件仍更新 HP、击倒、换宠、行动权与结果，下一次意图能够重新请求失败模块。Realtime token 与 Ably chunk 同样并行，连接前保持 1—2 秒 REST 回正且不误报离线，真实失败后继续恢复并能在网络恢复时重试。
- 当场结果：终局 room snapshot 必须为当前参与者返回完整 `terminal_result`，数据库已经原子完成 Stars、stake、reservation、ledger、summary、settlement 与 outbox。Web 立即应用终局快照并自动完成 Battle、identity、inventory 三域回正，结果覆盖层等待当前动作表现队列清空；三域失败按固定退避静默重试且不依赖用户按钮。按钮文案固定为“返回 Battle 首页”，点击网络记录中没有请求，只执行本地导航；随后迟到 bootstrap/room/Ably/命令响应不能重新打开同一结果。关闭、刷新、重新认证和重新打开后，Battle 与 identity bootstrap 均不返回旧结果；Battle 入口或 `/game` 进入 Battle 首页，普通入口仍进入默认首页。取消、过期和 prepared-share 作废不展示对战结果；玩家端不存在 history、result acknowledge、replay、audit、spectator、公开 room 读取 API或公开房间列表。
- 风控：邀请 waiting 或公开匹配 waiting 创建者被封禁后取消、退款、释放；lobby 任一方被封禁后双方退款并释放；active 任一方被封禁后页面空白、数据库继续托管至正常终局且只结算一次。

## 用户与登录第 16.11 节验收

以下 21 项逐项保存独立证据，不能合并为单一“登录通过”结论：

1. 首次有效 Telegram 登录先显示加载反馈，只创建一个 `normal` 账号并进入首屏。
2. 再次或长期离开后登录复用原账号、资产、权益、进度和邀请码。
3. 两个并发首次登录只产生一个账号和一个邀请码。
4. 非 Telegram、缺失 initData、签名失败、过期、未来超过 5 分钟和机器人均不能进入。
5. 恰好 24 小时与未来 5 分钟允许，越过边界拒绝。
6. 登录前后资产、藏品、资格、月卡、任务和邀请奖励均无登录赠送变化。
7. `normal` 完成交接后进入主界面，新前台生命周期停在默认开盒页。
8. 初始 `banned` 只渲染空白，DOM 不含提示、导航、资产、弹窗或按钮。
9. 使用中封禁立即清空页面；封禁前延迟成功响应不能写缓存、弹窗或导航。
10. 合法邀请候选在主页面前得到成功或唯一确定拒绝；直接调用业务 API 返回 `ENTRY_HANDOFF_PENDING`。
11. 同一 initData 一分钟第 4 次登录返回限流且页面不自动重试。
12. 网络/系统异常显示重新尝试；入口、时间、身份和限流错误不显示当前页重试。
13. 会话恰好 15 分钟绝对失效且不延长，自然过期只恢复一次。
14. 自动恢复重新读取账号和首屏，不重做资产业务；恢复得到 `pending` 时回到邀请确认。
15. 会话撤销或替换不自动恢复，旧页面清空并要求重新进入。
16. 多页面同时过期只执行一次认证交换并得到同一账号结果。
17. 恢复期间关闭重开后，旧 generation 结果不能写入新启动页。
18. 首屏整体失败保留内存会话与重试；摘要失败只影响对应区域。
19. 骨架、旧展示和加载动画最终由当前数据库事实覆盖，旧响应不能覆盖新登录。
20. UI 不存在密码、邮箱、手机号、手动用户号、钱包登录、退出、注销、删除或归档入口。
21. iOS、Android、Telegram Desktop、Telegram Web 的浅色、深色、刘海安全区和视口变化下，登录结果一致且全部启动控件可见可操作。

邀请交接场景必须额外记录会话 `referral_processed_at`、候选状态和门禁接口结果；存在绑定操作时记录原 `operation_id`，老用户静默进入场景确认候选与绑定操作均不存在；封禁竞态记录封禁前请求 generation、封禁后 generation、缓存键及最终空白界面截图；邀请信息记录 `/api/referrals` 为 200 且链接包含生产 Bot、`evomypet` 与当前用户邀请码。

## 账号语言与 en-US 本地化验收

开始本节前必须完成 [ADR-075](../architecture/adr/ADR-075-telegram-named-mini-app-release-isolation.md) 的入口恢复：`evomypet` Web App URL 已从 `/maintenance.html` 改回环境根 URL，Main Mini App 与默认菜单按钮已恢复；仍显示维护页的 named 直链不能作为语言功能验收入口。

语言验收必须使用同一 deployment SHA 的真实 iPhone Telegram Mini App，并同时用 Safari Web Inspector 检查 DOM、网络与控制台；静态词条检查、TypeScript、构建和桌面浏览器不能替代真机结论。不得创建视觉验收记录日志；证据按本文件既有模板保存引用。覆盖以下场景：

1. 清除该 Telegram 账号的 `preferred_language` 历史影响并首次进入时，认证完成前后都显示英语，页面根节点为 `lang="en"`；不能按 Telegram、设备或地区语言自动切成中文。
2. 五个主导航页面的既有顶部栏高度、safe area 和内容起点均保持不变；每页点击左上角同一玩家身份区域都打开账号菜单，菜单完整显示 `English / 简体中文`，不新增顶部常驻控件、不遮挡资产和 VIP，也不挤压手机顶部空间。
3. 在任一主页面选择简体中文时界面立即切换，网络只发送一次 `POST /api/me/language`，请求不含 `Idempotency-Key`；成功后 `identity.summary`、数据库账号值、根节点 `lang="zh-CN"` 和当前页面一致。重复选择当前语言不发送写请求。
4. 人为让语言写入失败时，界面恢复到切换前语言并给出当前语言的玩家可理解提示；不得显示路由、RPC、错误码、原始错误消息、数据库或请求处理措辞，也不得改变账号、资产、藏品、任务、Battle 或 operation 数据。
5. 同一 Telegram 账号在另一台真实设备首次打开时，以数据库 `preferred_language` 覆盖该设备的本地提示；设备 A 再改回 English 后，设备 B 完整重新进入也显示英语。换用另一 Telegram 账号时不得继承前一账号的偏好。
6. 逐页覆盖所有按钮、标签、空态、加载态、弹窗、结果页、错误提示、任务名称与说明、盲盒、210 个藏品名称、70 个进化链主题、50 个 Battle 技能，以及 Telegram Stars invoice、pre-checkout 提示和 Battle 分享卡；English 模式的 DOM 与外部文案不得出现汉字，简体中文模式保持原正式名称与含义。
7. 从英文界面完成开盒、市场、进化、分解、任务、转盘、VIP、邀请和 Battle 的正常与失败路径；所有稳定 ID、请求参数、模板归属、技能位置、属性、数值、概率、经济规则、数据库结果和账本变化必须与语言切换前完全相同。
8. 从冷启动、会话恢复、前后台切换、操作结果恢复和 Battle 终局分别验证当前语言不闪回另一语言；旧 generation 的迟到响应不能覆盖新账号的语言。Safari Console 中不得出现缺失词条、React key、渲染循环或响应契约错误。
9. iPhone 浅色、深色、刘海与动态视口下，账号菜单遵守顶部和底部安全区、焦点与滚动锁，两个选项触控目标至少 `44px`，关闭后回到原页面和滚动位置；减少动态效果设置下功能与可访问名称保持一致。
10. 对英语内容进行人工 en-US 游戏本地化复核：名称自然、简洁且有辨识度，按钮采用美国玩家熟悉的动作表达，不出现逐字硬译、中文语序或内部技术术语；该复核不能通过机器词条覆盖率自动判定为 PASS。
