# ADR-010：正式藏品图片资源

## 决定

固定 210 张 1024×1024 WebP 正式母版保存在 `assets/source/catalog/v1`，不进入 Web 构建输出。Node.js 24 使用固定版本 `sharp@0.35.3` 为每张母版生成 256×256、quality 82 的缩略图和 768×768、quality 88 的详情图；两种输出均使用 WebP、effort 6、alphaQuality 100 和 Lanczos3 缩放并移除元数据。

420 个运行时文件作为同一 Vercel Project 的版本化静态资源发布。`catalog.templates` 只保存 `image_thumbnail_path` 与 `image_detail_path` 两个相对路径；浏览器、Functions 和数据库均不代理或保存图片二进制。列表消费缩略图，主视觉和 NFT 元数据消费详情图。

缩略图单张上限为 50 KiB，详情图单张上限为 180 KiB，420 个文件总上限为 50 MiB。母版、运行时文件、路径、尺寸、格式、内容唯一性、checksum 和构建复制结果由发布门禁强制验证。

`/assets/catalog/:path*` 固定返回 `Cache-Control: public, max-age=31536000, immutable`。目录版本发布后不得覆盖；图片内容变化必须创建新的目录版本并原子同步数据库路径。成功 Mint 的 NFT 保留原元数据快照和原图片 URL。
