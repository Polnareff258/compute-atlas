# 视觉展示站点：参考与项目盘点

盘点日期：2026-10-04。此记录只包含当前仓库和所给参考页可核实的信息；设计方向与实现方案留给后续设计工作。

## 仓库事实

| 项目 | 已核实内容 |
|---|---|
| 技术栈 | `package.json` 声明 Next.js `^16.3.5`、React `^19.2.0`、Three.js `^0.186.0`、`@react-three/fiber`、`@react-three/drei`、Zustand、Zod、TypeScript、Vitest。 |
| 页面入口 | `src/app/page.tsx` 将 `RendererHost` 渲染在 `main.system-stage` 中；`src/app/layout.tsx` 导入全局 CSS 并设置站点元数据。 |
| 现有功能模块 | `src/renderer` 含渲染宿主、运行时、能力检测和 Canvas 适配；`src/scene` 含场景宿主、相机、材质、滚动、河流/地形/汇聚视图；另有 `src/boot`、`src/graph`、`src/ui`、`src/commands`、`src/telemetry`。 |
| 样式与本地资源 | 全局样式在 `src/app/globals.css`；应用内图标为 `src/app/icon.svg`。仓库根目录没有 `public/` 静态资源目录。 |
| 现有视觉记录 | `artifacts/` 中有大量本地 WebGL/WebGPU 截图、缩略图和运行日志；这些是项目过程产物，不等同于公开站点的素材库。 |

## Next.js 16 本地指南位置

仓库的 `AGENTS.md` 要求：编写代码前先读当前安装版本在 `node_modules/next/dist/docs/` 中的相关指南。与本次页面工作直接相关的文件：

- `01-app/01-getting-started/03-layouts-and-pages.md`
- `01-app/01-getting-started/05-server-and-client-components.md`
- `01-app/01-getting-started/11-css.md`
- `01-app/01-getting-started/12-images.md`
- `01-app/01-getting-started/13-fonts.md`
- `01-app/03-api-reference/01-directives/use-client.md`
- `01-app/03-api-reference/02-components/image.md`
- `01-app/03-api-reference/02-components/font.md`
- `01-app/03-api-reference/03-file-conventions/page.md`
- `01-app/03-api-reference/03-file-conventions/layout.md`

## Lusion 项目页可验证内容

| 页面 | 可验证事实 |
|---|---|
| [Lusion：DDD 2024](https://lusion.co/projects/ddd_2024/) | 页面文本标题为 “DDD 2024”；简介称 Digital Design Days 为期三天，聚集设计行业专业人士与品牌；列出的服务有 UI/UX design、3D Visual design、Creative Coding、Frontend development、Animation；有 “Launch Project” 外链，下一项目标为 Spaace。 |
| [Launch Project：Digital Design Days](https://1105-ddd2024-homepage.lusion.co/) | 抓取到的页面文本包含 Milan 2024 年 10 月 6–8 日活动信息；内容结构有导航/购票入口、主标题和活动简介、演讲嘉宾、主题列表、票种与价格、赞助商分组、新闻订阅和页脚链接。页面文本还标出 PLAY、MUTE 控件，以及设备、浏览器、WebGL、方向不支持时的提示文案。 |
| 视觉/运行状态边界 | 本次未能完成动态页面的浏览器实时读取（浏览器读取超时）；搜索索引/页面文本只能核实上述文字和链接结构。未验证实时动画、交互响应、加载流程、实际布局、颜色或渲染效果。 |

## 事实与推测边界

以上仓库结构、依赖声明和网页文字为已核实事实。将参考站点归纳为某种设计语言、判断其具体动画技术或推断其在不同设备上的实际表现，均超出本次可观察证据，不能作为事实引用。

