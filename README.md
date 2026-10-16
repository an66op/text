# 共鸣 · 社交前端

React 19 + TypeScript + Vite 6 + React Router 7 的手机优先社交前端。社交采用通讯 App 结构：手机会话列表与全屏聊天，桌面会话列表与聊天双栏；主导航为「社交、通讯录、发现、AI、我」。目前使用测试数据和浏览器本地状态，Go / PostgreSQL 后端尚未开发或接入。

「发现」提供动态、世界、直播、视频、圈子、匹配、短视频、小说、游戏、商城，圈子与匹配位于短视频前；「我」只保留钱包、设置。书架位于小说页。社交通讯包含私聊、群组、频道：群组用于成员讨论，频道采用 Telegram 式聊天时间线，由创建者以频道身份发布，订阅者可表态和进入消息评论线程。底部菜单只在五个一级页面显示，聊天、详情、表单、设置等二级页面使用完整页面。旧图文、贴吧等入口和个人动态、收藏、喜欢及统计区域不再显示。圈子内部通过频道组织讨论，具体结构见 [圈子功能说明](docs/CIRCLES.md)。

界面于 2026-10-15 统一为参考当前 iOS 设计思路的蓝紫视觉：浮动胶囊导航、大标题、圆形头像与控件、实体分组内容。设计 token 和样式分工见 [界面设计说明](docs/DESIGN_SYSTEM.md)。

## 启动与检查

```sh
npm ci
npm run dev
```

开发地址为 `http://localhost:5173`，端口占用时以终端输出为准。

| 命令                   | 用途                                   |
| ---------------------- | -------------------------------------- |
| `npm run dev`          | 启动 Vite 开发服务                     |
| `npm run check`        | 连续执行类型检查、Lint、测试、生产构建 |
| `npm run typecheck`    | TypeScript 类型检查                    |
| `npm run lint`         | ESLint 检查                            |
| `npm run format:check` | 检查 Prettier 格式                     |
| `npm run format`       | 格式化文件                             |
| `npm run test`         | 执行 Vitest 测试                       |
| `npm run test:watch`   | 监听模式运行测试                       |
| `npm run build`        | 生成 `dist/` 生产文件                  |
| `npm run preview`      | 本地预览生产构建                       |

## 工程结构

```text
src/
  main.tsx                    # React 入口、全局样式
  App.tsx                     # 路由与状态 Provider 组合
  app/                        # 路由表、App 布局、导航、错误与 404 页面
  features/
    social/                   # 私聊、群组、广播频道、通讯录、联系人与状态
    content/                  # 动态、发布、内容目录与详情、阅读、播放、游戏
    circles/                  # 圈子、频道、帖子、活动、成员与权限
    matching/                 # 兴趣匹配、资料、偏好与连接演示
    shop/                     # 商品、购物车、结算与本地模拟订单
    ai/                       # 本地助手演示、流式回复、草稿与历史
    discovery/                # 发现入口
    profile/                  # 个人资料、编辑、设置与状态
    wallet/                   # 钱包演示页面
  shared/
    config/                   # 路径与业务入口映射
    hooks/                    # 本地持久化 Hook
    lib/                      # 存储校验、媒体地址等公共逻辑
    ui/                       # 标题栏、Toast 与通用反馈
  styles/                     # 全局、通讯界面与响应式样式
  test/                       # 测试环境初始化
```

业务组件、类型、Mock 数据和状态放在对应 feature 内；测试跟随被测模块。`@/` 指向 `src/`。页面按路由懒加载，公共布局和状态 Provider 跨页面保留。主业务操作使用页面；聊天加号和表情是输入区下方的内联面板，临时筛选在所属组件内管理。

## 主要路由

路由定义位于 `src/app/router.tsx`，路径生成函数位于 `src/shared/config/paths.ts`。页面可直接访问、刷新，并支持浏览器前进和返回。

| 路径                                                     | 页面                   |
| -------------------------------------------------------- | ---------------------- |
| `/`                                                      | 跳转社交               |
| `/social`                                                | 会话列表               |
| `/social/chat/:conversationId`                           | 指定私聊或群聊         |
| `/social?type=channels`、`/social/channels/new`          | 频道订阅与创建         |
| `/social/channels/:channelId`                            | 广播频道详情           |
| `/social/channels/:channelId/info`                       | 频道资料、通知与订阅   |
| `/social/channels/:channelId/posts/:postId/comments`     | 消息评论线程           |
| `/contacts`                                              | 通讯录                 |
| `/discover`                                              | 发现                   |
| `/ai`、`/ai/history`                                     | AI 首页与会话历史      |
| `/ai/chat/:sessionId`                                    | AI 演示对话            |
| `/shop`、`/shop/products/:productId`                     | 商城与商品详情         |
| `/shop/cart`、`/shop/checkout`                           | 购物车与模拟结算       |
| `/shop/orders`、`/shop/orders/:orderId`                  | 本地订单与详情         |
| `/match`、`/match/preferences`、`/match/connections`     | 匹配、偏好与连接       |
| `/match/profile/:profileId`                              | 匹配资料               |
| `/activity`、`/activity/cover`                           | 动态与封面编辑         |
| `/publish`、`/people/:author`                            | 发布与用户主页         |
| `/world`                                                 | 世界文字动态           |
| `/world/posts/:postId`                                   | 动态详情与评论         |
| `/live`、`/videos`、`/shorts`                            | 直播、视频、短视频     |
| `/watch/:contentId`                                      | 视频或直播播放详情     |
| `/library`、`/bookshelf`、`/books/:contentId`            | 小说目录、书架与详情   |
| `/read/:contentId`、`/read/:contentId/settings`          | 小说阅读与偏好         |
| `/games`、`/games/:contentId`                            | 游戏列表与答题         |
| `/circles`、`/circles/new`                               | 圈子列表与创建         |
| `/circles/:circleId`                                     | 圈子首页               |
| `/circles/:circleId/channels/:channelId`                 | 频道内容               |
| `/circles/:circleId/posts/:postId`                       | 圈内帖子与评论         |
| `/circles/:circleId/voice/:channelId`                    | 语音房演示             |
| `/me`、`/me/edit`                                        | 个人中心与资料编辑     |
| `/settings`                                              | 设置                   |
| `/settings/:section`                                     | 账号、隐私、通知等设置 |
| `/wallet`                                                | 钱包演示               |
| `/wallet/earn`、`/wallet/earn/positions`                 | 理财产品与持仓         |
| `/wallet/earn/products/:productId`                       | 模拟申购与产品规则     |
| `/wallet/transfer`、`/wallet/transfer/review`            | 转账填写与确认         |
| `/wallet/receive`、`/wallet/exchange`、`/wallet/history` | 收款、兑换与记录       |

联系人查找、申请、资料和备注使用 `/contacts/...`；群管理、成员、公告、聊天搜索、消息详情及通话演示使用 `/social/...`。圈子邀请、加入、成员和管理使用 `/circles/:circleId/...`。完整路由表是 `src/app/router.tsx`。旧 `/moments` 地址自动跳转至 `/activity`，旧 `/organizations/...` 地址兼容跳转至相应圈子。

未知路径及无效内容 ID 会显示相应的空态或 404，并提供返回入口。

## 数据与演示功能

支持文字、表情与图片聊天、建群、未读与会话设置，以及动态发布、图片上传、点赞、关注、收藏、评论、内容加入、小说翻章、视频选集与弹幕、短视频切换、游戏答题。修改仅保存到当前浏览器，不会向其他用户发送消息。

持久化统一通过 `shared/hooks/useLocalStorage` 和 `shared/lib/storage` 管理，并校验读取的数据。表单修改同步保存，提交后跳转也能保留结果。保留旧版的动态、点赞、收藏、关注、评论、个人资料、会话和钱包存储键；旧 `joined` 名称记录迁移到书籍和组织各自的稳定 ID 存储，避免重名互相影响，原键保留。阅读进度按书籍 ID 保存，自己的帖子采用明确归属标记，不通过昵称判断所有权。工程重构无需清空已有测试数据。清除浏览器本站存储可恢复默认演示数据。

账号、内容、资产、地址、交易均为测试数据。直播使用示例视频，视频素材为公开 CC0 演示资源；Unsplash 和 Pravatar 图片需要网络。钱包只修改本地模拟余额与交易记录，不连接区块链、支付服务或实时行情；二维码编码本地 DEMO 数据，演示地址不能用于真实转账。

理财展示活期和定期的本地申购、持仓及赎回流程，年化为固定演示参数。申购本金从可用余额转入理财持仓，总资产包含持仓本金，赎回按产品规则归还本金。匹配使用成年虚构资料、兴趣偏好与本地喜欢记录，互相喜欢后展示连接，不请求设备定位或向其他用户发送内容。

商城提供固定商品、规格库存、购物车与模拟订单，不扣减钱包、不发起支付或配送。AI 入口是本地规则与示例回复的交互演示，包含流式显示、停止、重试、草稿、历史与可撤销删除；不会请求模型接口或 API Key。

## 部署与后端接入

生产构建发布 `dist/`。本项目使用浏览器 History 路由（`createBrowserRouter`），托管服务必须把不存在的页面路径回退到 `index.html`，否则直接访问或刷新 `/social/chat/...` 等页面会返回服务器 404。静态资源仍应正常按文件路径提供。例如 Nginx 的站点 `location /` 可使用：

```nginx
try_files $uri $uri/ /index.html;
```

后续接入 Go / PostgreSQL 时，可从各 feature 的 Provider 和数据方法替换 Mock / localStorage 读写，保持页面组件及路径接口稳定。优先补充用户鉴权、会话与联系人 API、实时消息、内容分页及媒体上传；阅读、圈子和钱包再按各自领域接入服务。不要把前端演示钱包或本地状态当作服务端可信数据。

下一阶段按「真机体验 → 社交可靠性 → Mock/API 数据边界 → 内容可靠性 → 后端接口设计」推进，具体范围和验收标准见 [下一阶段规划](docs/NEXT_PHASE.md)。前四批继续只做前端。
