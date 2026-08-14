# ADR-069：开盒渲染器预热复用与静态星域

## 决定

默认开盒页首屏事实就绪并完成 `gacha.open` 表现模块加载后，模块在浏览器空闲回调中创建一套真实 Canvas/WebGL 资源，并把 Canvas 永久保持在当前文档的固定根层 surface 中。根层 surface 使用与真实演出相同的窄屏宽度和稳定视口高度，因此空闲阶段即按当前 `hardwareConcurrency` 与减少动态效果设置完成 drawing buffer 分配、shader、context、program、buffer、vertex array 和一帧中性绘制；待机时只令整个 surface 透明，开盒表现激活和卸载时只切换可见状态，不改变 Canvas 或 surface 的父节点、尺寸和 backing buffer。全尺寸 Canvas 不得脱离文档或在演出挂载时重挂到弹层，否则 WebKit 会产生额外合成迁移。后续同会话开盒继续复用同一根层资源；质量档发生变化时释放旧实例并按新档重建，页面 `pagehide` 时释放池内资源。池被占用或空闲预热尚未执行时允许创建唯一的即时实例，但不得并行共享一个 WebGL context。

同一表现模块加载完成后，五核及以上设备必须在空闲回调中直接创建可复用的开场 Web Audio 风声 `AudioBuffer`，每次空闲回调最多填充 `4096` 个固定噪声样本并重新排队，禁止在单次 idle deadline 内循环填满整段 Buffer。用户点击只负责停止尚未完成的样本准备并解锁 `AudioContext`；Buffer 已准备时，动画组件挂载只创建轻量音频节点并复用它，不得把整段 Buffer 的创建、复制或逐样本填充放进 `AudioContext.resume()` 的异步回调或首轮可见呼吸。四核及以下设备固定不创建或解锁 `AudioContext`，也不播放风声、振荡器或揭晓噪声音效，并且在开场、服务端成功、揭晓阶段都不触发 Telegram `HapticFeedback`；真实 iPhone Telegram 的原生触觉桥接、Safari 首次音频管线建立和定时振荡器启动都会与可见 Canvas 帧争用。省略这些演出反馈不改变动画计时、业务请求或结果，结果舞台后续用户交互仍保留普通控件反馈。五核及以上设备的 Buffer 尚未准备、音频能力缺失或浏览器拒绝解锁时同样省略本次风声层，禁止回退为可见动画期间的同步生成。

汇聚阶段的 CSS `GachaAstralBackdrop` 固定为静态深黑渐变、静态星尘和无滤镜星云，不运行全屏 `blur`、`mix-blend-mode`、星尘呼吸、星云位移或第二套全屏黑洞呼吸。前 `4000ms` 的 13 次黑洞呼吸、事件视界、吸积流与螺旋粒子只由 ADR-067 的同一个 WebGL2/Canvas 渲染器驱动；最后 `700ms` 揭晓的金光、冲击环、触觉与音效保持 ADR-021 的现有裁决。移除重复 CSS 动态层不得改变呼吸周期、黑洞尺寸、粒子上限、颜色、图片门控、结果排序、概率、扣款、资格、保底、藏品或任何服务端结算。

Canvas 固定暴露 `data-astral-startup="warm|cold"`，并继续暴露 ADR-067 的渲染器、质量档、粒子数、呼吸周期和像素比属性。真实验收必须在 iPhone Telegram 中使用 Safari Web Inspector 同时核对该属性与 `requestAnimationFrame` 帧间隔；首屏静态检查、构建通过或部署 READY 都不能替代真机结论。

## 后果

- 动态模块仍按需加载，首屏同步闭包不引入 WebGL 代码、第三方运行时、图片、视频或序列帧；预热只在开盒页事实就绪后执行。
- 同一会话首次和重复开盒都不再把 shader 编译、GPU 程序资源初始化、音频噪声逐样本生成与首轮呼吸争用同一个可见帧，也不因离屏全屏 surface 重挂引入额外合成迁移；四核及以下设备也不再由首次音频管线建立、定时振荡器启动或 Telegram 原生触觉桥接打断可见帧；全尺寸 drawing buffer 已在永久根层 surface 上完成分配，激活只切换可见状态，不再承担首次 surface 扩展或父节点重挂。
- 程序化星域的视觉身份保持不变，但汇聚阶段只有一套动态黑洞时间轴，避免 WebGL 与 CSS 重复绘制全屏呼吸效果。
