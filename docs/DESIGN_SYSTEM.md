# 共鸣界面设计

## 方向

本轮采用当前 iOS 设计中清晰的导航层次、浮动控件、易读排版和分组内容，同时以蓝紫色建立共鸣的识别。参考 [Apple Human Interface Guidelines · Materials](https://developer.apple.com/design/human-interface-guidelines/materials) 与 [iOS 27 Design Resources](https://developer.apple.com/news/?id=e2lxw9l1)。这是一套在 Web 上实现的界面，不依赖原生 UIKit。

## 核心规则

- 导航与工具使用克制的半透明材质，正文、联系人与表单采用实体表面，保证阅读对比度。
- 四个一级页面保留原有信息架构，手机底部使用浮动胶囊导航；二级页面隐藏底栏并显示明确返回按钮。
- 大标题 34px，正文以 15–16px 为主；系统字体适配中文。主要操作提供至少 44px 的触控区域。
- 品牌主色 `#6260e8`、背景 `#f6f6fa`、文字 `#1d1e2b`；圆头像与 20–28px 内容圆角形成统一视觉。
- 动态帖子在手机上仍然满宽；正文间距与图片圆角由内容组件管理，不恢复旧的左右外边距。
- 控件状态同时用形状、文字或图标表达，不仅依赖颜色。保留可见键盘焦点，并响应减少动画、减少透明度和高对比度偏好。
- 手机底部内容为浮动导航预留 100px 与安全区，聊天二级页面把空间留给输入控件；桌面使用独立侧栏与自适应内容区。

## 代码位置

`src/styles/ios-theme.css` 定义共享 token、导航和通用控件。各 feature 的 `*-design.css` 承载内容层视觉，统一在 `src/main.tsx` 的旧样式之后导入，避免页面加载顺序改变视觉。

功能、公开路由与本地演示数据沿用现有实现。视觉迭代优先调整结构和可读性，不新增账号统计、已删除服务入口或营销横幅。

## 本轮验证

2026-10-15 已在 360px、430px 手机与 1280px 桌面完成 22 个关键页面的 66 组检查：无横向溢出，只有四个一级页面渲染底栏。390px 动态帖子仍然 x=0、宽度=390px。聊天输入面板展开前后都能保持最新消息可见，用户查看历史时保留滚动位置。

手机预览保存为项目根目录的 `preview-ios-contacts.jpg`、`preview-ios-discover.jpg`、`preview-ios-chat.jpg`、`preview-ios-settings.jpg`、`preview-ios-activity.jpg`。工程检查可运行 `npm run check` 与 `npm run format:check`。

本轮 122 项测试、类型检查、ESLint、生产构建和格式检查通过。独立审阅中修复了短视频覆盖层阻挡评论/作者/切换入口及底栏未读徽标对比度问题；上述短视频入口已在浏览器实际点击验证。
