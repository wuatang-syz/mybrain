# 知识地图切换中心卡住修复（2026-09-13）

## 原因和修改

宿主 BrainView.renderMap 在每次刷新时执行 status.before(mapStage)，即使画布已经位于状态栏之前，也会从 DOM 中移除并重新插入整个 WebGL 画布。原生 Obsidian 中可复现切换中心后画面停住；独立预览没有这一步 DOM 操作，因此之前的预览测试未覆盖这个问题。

现在先检查 nextElementSibling，只在画布不在目标位置时移动容器，切换注意层和选中笔记时保持同一画布持续挂载。不通过重建 Three.js 场景或切换模式绕过问题。

## 验证

- 修复前，原生 Obsidian 从个人知识库进入生活：中心和笔记数据已更新，镜头停在 71%；打开开发者工具导致尺寸改变后，WebGL 内容清空且不再重绘，控制台无报错。
- 修复后，已通过命令面板重新加载 Obsidian 并加载安装文件：生活返回个人知识库的镜头到达 100%；再次进入生活也到达 100%，健康星球与生活中心正常显示。全程未通过切换关系图谱或思维导图来恢复。
- 增加回归测试，连续切换 Root → A → B → Root 并重复刷新，MutationObserver 验证 live canvas 的容器不从页面移除，同时验证新中心数据被传递给画布。
- npm run sync 通过：29 个测试文件、257 项测试，ESLint、TypeScript、生产构建和安装同步通过。

修改：src/ui/view.ts；测试：tests/map-chrome.test.ts。
