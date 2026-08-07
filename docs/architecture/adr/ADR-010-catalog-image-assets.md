# ADR-010：Supabase Storage 宠物美术发布与保留

## 状态

已接受。

## 决定

宠物美术采用“私有母版 + 公开运行时 + Vercel 剪影”的唯一交付结构。Supabase Storage 私有桶 `art-masters` 永久保存全部历史母版并成为母版事实来源；公开桶 `pet-runtime` 只保存宠物运行时 WebP。Git 删除母版和宠物运行时二进制，只保留 `generated/assets/art-assets-v1.json`、SHA-256 与 `tools/assets/release.mjs`。非宠物美术继续随 Vercel 版本发布。

母版对象键固定为 `catalog/<template-id>/<source-sha256>.webp`。运行时对象键固定为 `catalog/v1/thumb/<template-id>.<runtime-sha256>.webp` 与 `catalog/v1/detail/<template-id>.<runtime-sha256>.webp`。Node.js 24 使用锁定的 `sharp` 版本，把每张 768×768 WebP 母版生成 256×256、quality 82 的缩略图和 768×768、quality 74 的详情图；两者均使用 WebP、effort 6、alphaQuality 100、Lanczos3 并移除元数据。上传固定 `upsert = false`，同键对象只能校验和复用，不能覆盖；公开对象返回 `Cache-Control: public, max-age=31536000, immutable`。

数据库以资源发布批次为原子切换单位。一个批次必须恰好覆盖 210 个模板及其母版、缩略图和详情图对象；当前批次指针和资源 revision 在单个 PostgreSQL RPC 事务内切换。API 字段固定为 `image_thumbnail_url` 与 `image_detail_url`，所有读模型在读取时从当前批次解析完整公开 URL。Battle 不保存图片 URL 快照，进化静态清单和市场设备收件箱也不持久保存 URL。资源发布独立于前端代码和 Vercel 部署；成功切换后全部模板实例统一显示最新美术。

受控发布命令按“本地校验与生成 → 私有母版无覆盖上传 → 公开 WebP 无覆盖上传 → 下载复核 SHA-256/尺寸/体积 → 原子发布 RPC → 读取当前批次复核”执行。发布键和 manifest SHA-256 提供幂等性；同键不同载荷拒绝，任一上传或校验失败不切换当前批次。环境只通过服务端 `SUPABASE_URL` 和 `SUPABASE_SERVICE_ROLE_KEY` 派生公开基址；清单不保存环境域名或密钥。

私有母版永久保留。旧公开对象从其最后引用批次退役起至少保留 90 天；仅在不被当前批次引用、所有引用批次均到期、没有有效回滚锁且对象不处于其他清理租约时，`/api/jobs/cleanup-catalog-assets` 才可领取最多 500 个对象并通过 Storage API 删除。Cron 使用 `CRON_SECRET`，数据库领取状态、过期租约和完成记录保证重复与并发触发幂等。删除失败回到可重试状态；禁止通过 SQL 删除 `storage.objects`。Supabase Storage 不提供对象版本或生命周期规则，因此保留、锁定和删除状态由应用数据库负责。

浏览器只允许直接 GET `pet-runtime` 的完整公开 URL，不加载 Supabase SDK，不持有 Supabase key，不连接 Supabase Postgres、RPC、Auth 或其他 Data API。宠物图片首次失败时维持固定尺寸，并显示 Vercel 内置 `/assets/pets/pet-silhouette.svg`；后台在 1 秒和 3 秒各重试一次，之后保持剪影。界面不显示服务器、Supabase、请求或资源故障文案。

## 完整性门禁

资源清单必须恰好包含 210 个模板、210 个私有母版对象和 420 个公开运行时对象；模板 ID、对象键、源/运行时 SHA-256、格式、尺寸、字节数、内容唯一性、发布批次和 manifest SHA-256 必须一致。缩略图单张不超过 50 KiB，详情图单张不超过 180 KiB，当前 420 个公开文件总计不超过 50 MiB。构建门禁确认 Vercel 输出不含宠物母版或运行时 WebP，并确认剪影存在。

## 回滚

回滚工具先下载并校验目标批次全部 420 个公开对象，再建立回滚锁并通过单个 RPC 切换当前批次。目标对象缺失或校验失败时禁止切换；操作员从私有母版重新生成，使用新发布键发布一个完整新批次。回滚不会删除当前或历史私有母版。
