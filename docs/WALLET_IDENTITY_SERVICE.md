# 钱包身份契约（v0.9 / schema 9）

本阶段把公开钱包连接升级为已有账号的另一种登录凭证。仅接入 EVM EOA 的 ERC-191 `personal_sign` 和 EIP-4361 SIWE；不会自动创建账号，不提供合约钱包/ERC-1271 验证、密码重设、转账或链上资产。邮箱密码注册与登录继续可用；已绑定钱包可重新登录账号，忘记密码后的密码重设仍待实现。种子数据不保存私钥，也不自动绑定示例地址。

## 认证与浏览器并发

新增 `gongming_auth_browser` HttpOnly/SameSite=Lax Cookie，Secure 随部署配置，Path=/api/v1。数据库只存随机秘密的 SHA-256；秘密不在 JSON、URL、日志或个人备份里。上下文固定有效期 30 天，不在普通 GET 中轮换或延期；新会话有效期不得超过上下文期限。过期后重新建立上下文并明确重新认证，不收编旧钱包会话。

`GET /api/v1/auth/context` 要求 `X-Gongming-Browser: 1`，返回 `{generation, expiresAt}`。generation 是全局不碰撞的随机公开版本，不是从零开始的整数。无有效上下文时建立新上下文；已有有效上下文只读，不依据请求里的 session 改写指针、推进版本或重发 Cookie。首次并行初始化可能得到不同上下文，后续验证必须失败关闭。前端 Web Locks 只减少同源竞态，不构成授权依据。

浏览器的密码登录、注册、退出、SIWE challenge/verify，以及钱包解绑均携带 `X-Gongming-Browser: 1`、`X-Gongming-Auth-Generation`。缺少上下文或版本不符返回 `409 auth_context_changed`，不设置/清除 Cookie。真正没有浏览器模式、generation、钱包 challenge 的旧 CLI 密码认证保留兼容；钱包认证始终要求上下文，不能通过删除 Cookie 降级。

成功登录/注册/退出以事务 CAS 锁住上下文；撤销该上下文原指针的旧 session（即使请求携带的是过时 Cookie），更新指针并生成新 generation。显式替换旧 legacy session 时同时撤销请求的旧 session。State 兼容事务必须在加载快照前锁/CAS，在 session 持久化后更新指针；钱包 SQL 使用同一顺序：browser → account/session → challenge → binding → related sessions。整笔事务可重试，不能重放旧 State patch。登录/注册/钱包登录返回原有 `{user,expiresAt}`，可附加新的 authGeneration；客户端每次认证操作前获取当前 context，不自动重试失败的写操作。

新浏览器会话保存原 context hash；所有 State、窄 SQL、媒体和 WebSocket 入口统一检查 session 与当前 context Cookie 及数据库指针匹配。原 session 被撤销后既有 WS 失效；初次并行上下文 C1/C2 与迟到 Cookie S1/C1 的混合也不得获得旧账号权限。请求带 context 时，旧 legacy 会话也不能例外放行；首次启用 context 不收编旧 session，浏览器需明确重新登录。仅真正不带 context/浏览器模式的旧 Cookie 保持原鉴权，兼容原检查点与 CLI。前后台初次初始化先准备 context 再读取身份。不能只保护 `/auth/me`，也不能把失配的旧 session 自动移入新 context。明确的新登录可在失配后重新认证；`/auth/context` 不返回用户身份。此设计阻止迟到响应恢复旧权限，但无法阻止浏览器应用迟到的 Set-Cookie，极端情况下需重新登录。

## API（统一 data/error 信封）

| 方法与路径                        | 输入 / 输出                                                                                                                                                                                                    |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET `/auth/wallet/config`         | `{enabled, origins: string[], chains: string[], maxBindings: 5, challengeTTLSeconds: 300, contractWallets: false}`；不泄露用户                                                                                 |
| POST `/auth/wallet/challenge`     | `{purpose: 'login'\|'bind', address, chainId: string, password?: string}`；bind 要求当前账号、原 session 与当前密码，login 不传密码。返回 `{id,purpose,message,address,chainId,origin,uri,issuedAt,expiresAt}` |
| POST `/auth/wallet/verify`        | `{id,message,signature}`；完整 message 必须等于服务端保存的 canonical 文本。login 返回 `{user,expiresAt}`，bind 返回 `{binding: WalletBinding}`                                                                |
| GET `/me/wallet-bindings`         | `{items: WalletBinding[], maxBindings:5, hasPassword:true}`；只返回当前账号活跃绑定                                                                                                                            |
| DELETE `/me/wallet-bindings/{id}` | `{password}`；返回 `{ok:true, revokedSessions:number, currentSessionRevoked:boolean}`，成功后重新读取列表/当前身份，不依据本地推测删除                                                                         |

`WalletBinding = {id,address,boundAt}`。address 为 EIP-55 显示文本，绑定按 20 字节地址全局唯一，跨链属于同一身份。不返回其他账号、邮箱、浏览器秘密、session token/hash、完整 nonce 历史或签名。绑定冲突提示通用“该钱包无法绑定”，不透露归属。每账号最多 5 个活跃绑定；当前账号均有密码，无最后凭证降级/账号合并。

无会话为 401；签名/密码复核错误为 403 `wallet_proof_failed`（不触发有效 session 全局退出）；过期/已消费/失效 challenge 为 409 `wallet_challenge_invalid`；上下文版本冲突 409 `auth_context_changed`；已绑定/额度为 409；不支持的 chain/address/signature 格式为 400。login 失败不会把另一账号的有效会话登出。未知提交结果先读取 `/auth/me` 或绑定列表确认，不自动重新签名/消费新 nonce。

## 签名、用途与失效

服务端从显式 `WALLET_ORIGINS` 精确选择请求 Origin（必须同时在 ALLOWED_ORIGINS），不信任 Host/X-Forwarded-*。开发默认仅 localhost:5173 与 127.0.0.1:5173；后台端口不提供钱包认证。生产缺配置时钱包能力关闭；格式错误启动失败。origin 不带路径/query/fragment/userinfo，生产 HTTPS。`WALLET_CHAINS` 使用规范十进制字符串，开发默认 `1,11155111`；未配置的链拒绝，不能通过 JS Number 截断超大 chainId。

服务端产生固定 ASCII 语句（login/bind 不同，bind 含不透明账号 ID，不含用户输入）、精确 origin authority（含端口）、URI（origin + `/login/wallet` 或 `/account/wallets`）、版本 1、链 ID、256-bit 随机 alphanumeric nonce、Issued At / Not Before / Expiration Time（最多 5 分钟，受 context 剩余有效期限制，统一整秒）与 challenge ID Request ID。客户端展示完整文本并显式点击后才调用 personal_sign，不自动签名。

验证 ERC-191 消息字节长度与 Legacy Keccak-256，恢复 secp256k1 公钥并按地址 20 字节比较。仅 65 字节 r/s/v，v 0/1/27/28，合法非零 r/s、low-s；拒绝交易/EIP-155 v、截断、错用途/域/URI/链/消息/时间。只支持 EOA，不把无需 RPC 的恢复冒充智能合约钱包验证。

challenge 绑定 browser hash + generation；bind 额外绑定原 user + session hash +账号 wallet-auth version，login 固定发起时的 active binding ID（不存在也不能随后自动匹配新绑定）。nonce 单次消费与绑定/登录事务原子提交；错误签名计数最多 5 次，计数需持久化但不得写业务成功结果。数据库对 browser/address/account 发行数量设界，进程/IP 限流另保留。成功提交后才发 session Cookie。

解绑软撤销绑定，撤销所有从该绑定登录的会话（包括当前）；密码或其他绑定的会话保留。解绑不发送可能迟到覆盖新身份的清除 session Cookie；失效 session 本身拒绝访问，客户端刷新确认。每次绑定/解绑以及账号状态变更都递增 wallet-auth version，使旧绑定挑战、停用前挑战、解绑再绑定前挑战不能复用。普通设备撤销不会解绑钱包；UI 说明该差异。账号停用、会话撤销与 wallet verify 竞争必须在相同提交语义下安全。

## 持久化与界面

四个独立 SQL 域表：wallet_bindings、siwe_challenges、wallet_session_proofs、auth_browser_contexts；用户增加私有 wallet-auth version，新 session 增加 auth method/context metadata。历史会话的 auth method 明确 unknown，不凭旧资料猜测 password；新密码与钱包登录有真实来源。普通 State 不加载 challenge、上下文和绑定历史，兼容写入不得覆盖 SQL 专有元数据。管理员只见能力状态和安全审计标签，不代绑/转移/代签。审计不写 message/nonce/signature/password/浏览器秘密。

前台新增 `/login/wallet`、`/account/wallets`，在登录、账号与 Web3 入口可达，沿用紧凑透明页头和手机布局。选择钱包 → 连接 → challenge → 完整预览 → 显式签名确认 → 服务端确认。钱包 provider/address/chain 任意变化（包括 A→B→A）、断开、卸载或账号 epoch 变化都令当前操作失效；同步单飞，迟到 connect/sign 不恢复旧状态，签名前与提交前重新核对 provider/address/chain。签名等待不锁住全部账号操作；最终 wallet login 加入 AuthProvider 原认证单飞/CAS，不能页面自行写 session。个人备份不包含凭证。

后台密码登录/退出同时接入 context CAS，以处理共享 host Cookie。设备页展示密码/钱包/历史未知来源；链接钱包管理。测试积分/转账账本与钱包身份独立，不把绑定地址视为资产余额。

## 验收

真实随机内存私钥生成 ERC-191 签名，经 HTTP 验证绑定/登出/登录/解绑与原会话撤销；失败签名、重放、错浏览器、错用途、过期、停用/恢复、解绑重绑、session 撤销、并行消费/唯一绑定竞争、同上下文及双初始化迟到 Cookie、generation 缺失降级、所有鉴权面失配都需覆盖。测试密钥不写磁盘或日志，开发示例不绑定不可恢复的钱包。

旧库迁移前保留所有 37 个旧数据投影、媒体文件与最早 Cookie 检查点；schema9 不自动绑定公开连接，也不重写旧字段。完整测试/格式/vet/依赖漏洞检查、真实 PostgreSQL/HTTP 与离线备份恢复/重启检查后再提交 Git。工具禁用时明确记录未做浏览器/扩展/真机视觉验收。

标准：[EIP-4361](https://eips.ethereum.org/EIPS/eip-4361)、[ERC-191](https://eips.ethereum.org/EIPS/eip-191)、[EIP-55](https://eips.ethereum.org/EIPS/eip-55)、[EIP-6963](https://eips.ethereum.org/EIPS/eip-6963)、[RFC 6265 并行 Set-Cookie](https://www.rfc-editor.org/rfc/rfc6265#section-4.1.1)。
