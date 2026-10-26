# 部署配置

本目录提供生产前台、React 运营后台、Go API、PostgreSQL 四个 Compose 服务。前台/后台各由独立 Nginx 提供静态文件及 `/api/` 同源反向代理，API 和数据库不发布宿主机端口。

**当前机器未安装 Docker。本次只验证了 YAML 结构、Shell 语法、环境预检及官方镜像 manifest，未执行镜像构建、`docker compose config` 或容器运行。** 本地 Go/PG 和 React 的运行验证不等于这套容器已经上线。下列容器验收命令必须在有 Docker Engine + Compose v2 的部署主机执行。

## 结构与镜像

- `Dockerfile` 多阶段分别构建 frontend、admin、api；两套 React 都使用根目录 `package-lock.json` 的锁定依赖。Admin 新增依赖时须同步根锁文件，避免本地偶然存在而容器缺失。
- API 用 Go 1.27.3 构建静态可执行程序；运行时非 root。Nginx 非 root 监听 8080，前后台只读文件系统，临时目录为 tmpfs。
- Node 26.12.1、Go 1.27.3、Nginx 1.31.8、Postgres 16.15、Alpine 3.24 官方多架构镜像都固定 registry index digest。2026-10-27 通过 Docker Registry V2 manifest 验证了这些 digest 存在且覆盖 Linux amd64/arm64。更新镜像时应重新验证、扫描和运行容器验收，不能仅更改标签。
- `database` 私有网络只连 DB/API；`edge` 连 API/两套静态服务。DB 初始化创建非超级用户 gongming 作为应用数据库 owner，超级用户密码独立且只挂给 DB；API 没有服务器级建库/建角色权限。DB 使用持久化命名卷，前后台仅绑定宿主机 `127.0.0.1:8081`、`127.0.0.1:8082`，由宿主机 HTTPS ingress 对外提供服务。

## 首次部署

1. 生成独立生产密钥，保存在仓库外。示例在部署主机上以管理员身份执行，不输出密码：

   ```sh
   sudo install -d -m 0700 /etc/gongming
   sudo sh -c 'umask 077; openssl rand -hex 32 > /etc/gongming/postgres-admin-password'
   sudo sh -c 'umask 077; openssl rand -hex 32 > /etc/gongming/postgres-password'
   sudo sh -c 'umask 077; openssl rand -hex 24 > /etc/gongming/bootstrap-admin-password'
   sudo chmod 0444 /etc/gongming/postgres-admin-password /etc/gongming/postgres-password /etc/gongming/bootstrap-admin-password
   ```

   本地文件型 Compose secret 保留宿主机文件权限，API UID=65532 需要读取权限，因此这里用 **0700 父目录 + 0444 文件**：普通宿主机用户不能遍历目录，容器内仅被授权的服务得到只读 secret 挂载。不要将 secret 内容放入 Git、镜像构建参数或 Dockerfile。API 入口验证 DB 密码为至少 32 位十六进制，环境预检要求生成的 64 位值，避免 DSN 特殊字符歧义。

2. 复制环境模板并填入实际域名、管理员邮箱、绝对 secret 路径：

   ```sh
   cp deploy/production.env.example deploy/.env.production
   chmod 0600 deploy/.env.production
   ```

   `APP_ORIGIN=https://你的前台域名` 和 `ADMIN_ORIGIN=https://你的后台域名` 必须是不同的完整 HTTPS origin，不含路径或结尾 `/`。不能保留 example.com。初次启动填写 BOOTSTRAP_ADMIN_EMAIL / HANDLE；管理员密码从 secret 读取。新生产数据库无任何开发种子账号。

3. 进行环境预检、Compose 模型验证和构建，然后启动：

   ```sh
   sudo node deploy/validate.mjs deploy/.env.production
   docker compose --env-file deploy/.env.production -f deploy/compose.yaml config --quiet
   docker compose --env-file deploy/.env.production -f deploy/compose.yaml build --pull
   docker compose --env-file deploy/.env.production -f deploy/compose.yaml up -d --wait
   docker compose --env-file deploy/.env.production -f deploy/compose.yaml ps
   ```

   若当前账号无权读取 root 所有的 secret 文件，请用相同权限运行 Compose。`config --quiet` 避免把完整配置打印到共享终端。容器有真实 DB/API/静态健康检查，API 等 DB healthy，静态服务等 API healthy。

4. 在宿主机 HTTPS ingress 配置两套域名和有效证书，参考 `ingress.nginx.example`。先执行宿主机 `nginx -t` 再重载。此示例假设 ingress 与 Compose 在同一台宿主机；若 ingress 也在容器内，127.0.0.1 指其自身，应接入专用 edge 网络后使用服务名，不可照搬该示例地址。

5. 用 HTTPS 浏览器注册成员、登录运营后台，验证以下完整链路：

   - 前台 `/world` 等深层页面刷新返回 SPA；后台 `/content` 等深层路由刷新也正确。静态缺失的 `/assets/` 返回 404，不回 index.html。
   - 登录响应设置 Secure / HttpOnly / SameSite=Lax cookie；前后台 cookie 按主机隔离，分别登录。不要在浏览器用 HTTP 回环端口尝试登录，Secure cookie 在该路径不能作为生产验证。
   - 成员发动态 → 后台搜索并隐藏 → 前台公共流不再显示；提交举报 → 后台填备注处理 → 审计记录。
   - 两成员之间私聊、建群、频道主发布；非成员读取和订阅成员发频道消息被拒绝。
   - 测试钱包领取、转账、刷新后余额一致；重复 requestId 不重扣。该账本没有真实资产价值。

数据库初始化脚本只在空卷运行，DB 管理密码与应用密码必须分别随机生成。修改 secret 文件不会自动变更 PostgreSQL 已有角色密码；轮换时须先在数据库执行角色密码变更，再同步 secret 并重建 API，避免只改文件造成失联。

管理员创建成功后，清空环境文件中的 `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_HANDLE`，重新创建 API 容器。可将 bootstrap secret 文件替换为空文件并保留 0444 模式；此后该 secret 不再用于登录或重置密码。不要通过删除数据库卷来重置管理员，生产账目和内容会丢失。

## HTTPS、来源与运行边界

Compose 强制 `APP_ENV=production`、`COOKIE_SECURE=true`，只允许配置的两个 HTTPS Origin 写入。Nginx 保留 Origin 和 API URI，接收并转发 Set-Cookie，没有跨域 CORS 通配符。API 默认不信任 X-Forwarded-For，当前源 IP 限流按 Nginx 服务 IP 聚合；正式公网使用应增加 ingress 分布式限流和可信代理配置，不能简单信任任意用户提供的转发头。

TLS 由外层 ingress 终止，Compose 内部 API/PG 使用隔离 bridge 明文通信；这是单宿主机部署布局。多宿主机或不可信网络应使用专用网络、服务间 TLS 和受管数据库。私钥/证书由部署环境管理，不放入此仓库。

生产 API 拒绝包含 `user_demo` / `user_admin` 开发种子的数据库；不设置 APP_ENV=development，不注入 Demo2026!/Admin2026! 或 gongming_dev，不复用 `.runtime/postgres` 数据目录。数据库凭据和运行时配置不进入前台 Vite 构建，浏览器只能调用同源 `/api`。

## 数据保护与升级

PostgreSQL 数据存放于 `gongming_postgres-data` 命名卷。`docker compose down` 保留数据；`down -v` 会销毁数据，仅空测试环境允许。任何更新前需备份并在独立环境验证恢复：

```sh
umask 077
docker compose --env-file deploy/.env.production -f deploy/compose.yaml exec -T db \
  pg_dump -U gongming -d gongming -Fc > gongming-backup.dump
# 在独立数据库执行 pg_restore 验证；不要未经审查覆盖正在服务的生产库。
```

单机 Compose 没有自动异地备份、自动证书管理、滚动发布、生产监控或灾备编排。当前后端已将主数据迁移到规范化关系表，普通 handler 仍进行全域快照读取并按实体增量写入，存在读放大；WebSocket outbox 另有窄 SQL 查询。按域 SQL、独立消息服务、金融级复式账本、对象存储/审核、分布式限流、压测和可观测性需要后续推进。升级前须备份并停止旧版写入；schema v2 迁移保留旧表，不支持旧 API 直接回写。详见 `server/README.md`。

## 本次配置检查记录

已通过：Ruby YAML 解析和服务/网络/挂载静态断言、`sh -n deploy/api-entrypoint.sh`、生产环境预检有效/无效夹具、官方 registry 多架构 digest 查询、根锁文件与 admin 共享依赖范围检查。

未执行：Docker build、容器内 `nginx -t`、Compose `config`/健康启动、HTTPS ingress 联调、镜像运行安全扫描。部署时应执行上面的步骤，发现失败必须修复后再上线。

参考：[Docker Compose 服务配置](https://docs.docker.com/reference/compose-file/services/)、[Nginx proxy](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)、[官方 PostgreSQL 镜像](https://hub.docker.com/_/postgres)。

WebSocket 需要外层 ingress 和内部静态 Nginx 同时透传 Upgrade/Connection，并保持代理读超时大于服务端心跳周期；本目录已配置，但仍需实际容器/TLS 验收。参考 [Nginx WebSocket 代理说明](https://nginx.org/en/docs/http/websocket.html)。
