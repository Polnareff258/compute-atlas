# AFTERFORM 验收清单

状态更新：2026-10-04。视口和交互结果来自浏览器模拟；没有在实体移动设备上测试。

## 视口与构图

- [x] 桌面模拟 1440×900：无横向溢出，可见银色折叠雕塑；原生滚动会真实改变雕塑形态。证据：[首幕](../../artifacts/afterform/form-desktop.jpg)、[融化幕](../../artifacts/afterform/melt-desktop.jpg)、[解构幕](../../artifacts/afterform/fracture-desktop.jpg)。
- [x] 桌面模拟 1920×1080：无横向溢出。证据：[宽屏首幕](../../artifacts/afterform/form-wide.jpg)。
- [x] 移动端模拟 390×844：无横向溢出，标题与主体不重叠，Canvas DPR 为 1。证据：[移动首幕](../../artifacts/afterform/form-mobile.jpg)。
- [x] 平板模拟 768×1024：无横向溢出，主体完整；未保存截图。
- [ ] 实体移动设备、安全区、实际触控目标尺寸及设备帧率：未测。

## 旅程与控件

- [x] 原生滚动会驱动雕塑形态变化。
- [x] 四章可用键盘导航跳转。
- [x] 重播可回到开头。
- [x] 音频开关状态可正常切换。
- [x] `prefers-reduced-motion: reduce`：显示静态章节画面。证据：[减少动态效果](../../artifacts/afterform/reduced-mobile.jpg)。
- [x] WebGL 上下文丢失：出现静态回退和重试入口，点击重试后恢复实时画面。
- [x] `getContext` 返回 `null`（设备不支持 WebGL）：不创建 Canvas，显示重试入口；点击重试后可恢复实时画面。
- [ ] 实际音频响度及实体手机扬声器表现：未测。
- [ ] “回声”幕粒子重新聚合的独立视觉结果，以及全程双向往返的连续性：尚未完整验证。

## 自动检查

- [x] 全仓 Vitest：42 个测试文件、331 项通过。
- [x] TypeScript 检查：退出码 0。
- [x] 全仓 ESLint：退出码 0。
- [x] 最新 `npm run build`：退出码 0；编译约 3 秒、类型检查约 12.7 秒，静态输出通过。
- [x] 最新目标 ESLint：退出码 0。
- [x] 最新目标 Vitest：2 个文件、11 项通过。
- [ ] 实体设备 FPS、帧耗时与性能预算：未测。

未完成项保持未勾选。浏览器窗口模拟不能代表实体设备表现，也不构成性能承诺。
