# 接口与部署说明（给开发人员）

商家实际操作先看 [商家使用说明](使用说明.md)。这份文档解释当前代码如何保存数据、哪些接口已实现、换后端时要保留什么。**当前后端是 TypeScript + Cloudflare Workers/D1/R2，不是 Spring Boot/MySQL；支付与物流还没有接通。**

## 一张表看清状态

| 部分 | 当前实现 | 迁移或正式营业时 |
| --- | --- | --- |
| 页面 | Next.js / React 前台与后台 | 可继续沿用 |
| API | 同域 /api/v1，服务端处理 | 可换成同路径的自建后端 |
| 数据 | D1 保存商品、规格、订单、后台记录 | 可迁移到 MySQL，需重写数据库适配 |
| 图片 | R2 存上传图片，接口返回图片地址 | 可换对象存储，但要保持公开可读的图片地址 |
| 身份 | 预览环境的 ChatGPT 登录 + 服务端 admins 授权 | 自建环境必须自行实现安全登录和会话 |
| 交易 | 只创建体验订单，真实收入为 0 | 接支付、退款、物流、通知、税费发票并做端到端验证 |

仓库上传与部署是两件事。公开 GitHub 仓库里没有管理员激活码、支付密钥或生产凭证。当前私有预览的站点访问权限也不会因为复制源码而自动迁移。

## 代码从哪里开始看

| 路径 | 作用 |
| --- | --- |
| components/store.tsx | 顾客页面和体验结算 |
| components/admin.tsx、components/admin-login.tsx | 后台与登录界面 |
| lib/api.ts | 前端所有 API 请求的入口 |
| app/api/v1/[...path]/route.ts | 把 HTTP 请求交给业务处理器 |
| lib/commerce.ts | 商品、库存、订单、权限、售后等接口逻辑 |
| lib/server.ts、db/ | 身份、数据库连接及数据结构 |
| scripts/test-commerce.mjs | 业务控制器集成检查 |
| .openai/hosting.json | 已有预览环境使用的 DB、BUCKET 绑定名称 |

当前预览环境需要 D1 绑定名 DB、R2 绑定名 BUCKET，以及只在服务端提供的 ADMIN_ACTIVATION_CODE。激活码用于第一次绑定主管理员，不能写到前端变量、提交到 GitHub，或当作自建账号系统的长期密码。复制仓库到普通服务器后，这些托管服务与 ChatGPT 登录不会自动存在；需要先配置等效能力再部署。

## 接口约定

接口基址为 /api/v1。前端在 lib/api.ts 中统一调用；可设置 NEXT_PUBLIC_API_BASE 指向**同源代理后的** API 路径。成功响应为 {"success":true,"data":...}，失败响应为 {"success":false,"error":{"code":403,"message":"..."}}，同时返回相应 HTTP 状态码。普通错误的 `error.code` 仍是 HTTP 状态码数字；具有明确恢复语义的业务错误可返回字符串 code。前端 `api()` 抛出的错误保留 `status` 和 `code`，无需匹配中文提示。

金额使用整数分：1890 表示 RM 18.90。库存、数量是整数。客户端提交的总价不可信，服务端依据商品当前售价、优惠与运费重新计算。写请求检查同源 Origin；登录会话由服务端读取，不能信任客户端自行填写的账号或角色。

### 顾客接口

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | /catalog | 在售商品、规格、首页内容、配送方案及公开评价 |
| GET | /session | 当前账号和是否有后台权限 |
| POST | /coupon/quote | 预估优惠，下单时还会复核 |
| GET、POST | /orders | 本人订单列表；创建体验订单 |
| POST | /orders/{id}/cancel | 取消自己的待付款订单 |
| POST | /orders/{id}/aftersales | 为自己的订单申请售后 |
| GET | /my/aftersales | 查看本人售后进度 |
| GET、POST、DELETE | /my/addresses、/my/addresses/{id} | 保存、读取和删除本人地址 |
| GET、POST | /tickets | 本人客服留言和回复 |
| POST | /reviews | 评价自己的已完成订单，先待审核 |
| GET | /media/{key} | 读取已上传图片 |

创建订单时提交 idempotencyKey（UUID）、items 中的 skuId 和 quantity、customer 收货信息、shippingId、coupon，以及 acknowledgeDemo=true。服务端校验商品上架、规格启用、库存、优惠、配送；在数据库事务内写入订单和扣库存。相同账号使用同一幂等键不会生成两笔订单。订单仅支持马来西亚收货地址与 MYR。

顾客订单列表、新建及幂等重试响应使用同一字段白名单，包括订单金额、状态、配送信息、顾客自己的收货快照和商品明细。顾客留言 `customer.note` 保留；后台内部备注（顶层 `note`）及未明确允许的内部字段不会返回给顾客，嵌套快照同样受此限制。后台订单与报表仍保留内部备注。

### 后台接口

所有 /admin 路径都在服务端检查管理员角色与启用状态；页面上隐藏按钮只是界面表现，不代替鉴权。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| POST | /admin/activate | 已登录账号用服务端激活码首次绑定主管理员 |
| GET | /admin/bootstrap | 读当前管理员角色和权限 |
| GET、POST、PATCH | /admin/products | 列表、新增、修改商品 |
| GET、POST | /admin/inventory | 读库存与调整流水；delta 为正数入库、负数出库 |
| GET | /admin/orders | 后台订单列表 |
| PATCH | /admin/orders/{id} | 备注、演示确认、测试发货、测试完成或取消 |
| GET、POST、PATCH、DELETE | /admin/records/{kind}、/admin/records/{kind}/{id} | 分类、优惠、配送、内容、店铺设置、客户、售后、评价、工单；各类型允许的操作不同 |
| GET、POST | /admin/staff | 员工授权与启停，仅主管理员 |
| POST | /admin/uploads | file 字段上传图片 |
| GET | /admin/reports | 体验订单统计；realRevenue 为 0 |
| GET | /admin/audit | 操作记录 |
| GET | /admin/integrations | 外部服务连接状态，目前均未连接 |

records 的 kind 包括 categories、coupons、shipping、content、settings、customers、aftersales、reviews、tickets。售后、评价、工单只能处理顾客已有记录，后台不能伪造申请。商品与订单没有物理删除入口。

商品字段包括 name、nameEN、description、descriptionEN、category、images、detailImages、origin、storage、ingredients、status、variants。每个规格包含 id、label、price（整数分）、stock、active、image（可空，空值回退商品首图）。商品新增 nameMS、descriptionMS，分类新增 nameMS，首页内容新增 titleMS、descriptionMS；缺少马来文时页面回退英文，再回退原文。修改商品要带 id 和 revision；版本冲突返回 409。已有规格的库存只能经 /admin/inventory 调整，编辑商品时的 stock 不会覆盖它。图片最多 12 张主图、20 张详情图；上传单张不超过 5 MiB，只收 PNG、JPEG、WebP、GIF，文件内容会做格式检查。

### 库存调整的幂等请求

`POST /admin/inventory` 必须提交 `operationId`（UUID）、`expectedAdminUserId`（发起操作时后台 bootstrap 返回的管理员账号 ID）、`skuId`、非零整数 `delta` 和 `reason`。一次业务调整只生成一个 operationId；首次发送前保存操作编号和完整请求，网络重试、刷新或重新打开未确认操作时沿用原请求，包括原 expectedAdminUserId。服务端将 UUID 规范为小写，并去掉预期账号 ID、SKU 编码、原因两端空白。

服务端先根据当前登录会话检查库存权限，再将真实账号 ID 与 expectedAdminUserId 比较；不一致时，在查询重放流水或写入之前拒绝请求。该字段仅用于检测确认期间的账号切换，不用于取得权限或决定流水归属；实际操作者始终来自当前登录会话。

成功的 `data` 是固定收据：`{ "ok": true, "operationId": "UUID", "skuId": "tin-50", "delta": 5, "reason": "采购入库", "createdAt": "ISO时间" }`。同一个已授权账号、同一个 operationId、相同规范化参数，无论串行还是并发重试，都返回首次保存的收据，不重复修改库存或生成成功审计。收据不包含会继续变化的当前库存；需要时另行读取库存列表。账号显示名变更不影响重放，权限和启用状态仍会在每次请求时检查。

| 情况 | HTTP状态 / error.code | 客户端处理 |
| --- | --- | --- |
| operationId 或 expectedAdminUserId 缺失，或格式/参数无效 | 422 / 422 | 修正请求，旧页面需要刷新；服务器不会补生成操作编号 |
| 当前登录账号与发起操作时的 expectedAdminUserId 不一致 | 409 / `inventory_actor_changed` | 保留原请求和原账号归属，切回原账号核对或重试；不能用新账号替换预期账号后自动重发 |
| 同一编号已用于不同 SKU、数量、原因或另一个账号；或编号对应无法验证账号的历史流水 | 409 / `inventory_operation_conflict` | 核对原操作，不能自动换编号重新提交 |
| 库存不足或 SKU 不存在，事务已回滚且重查未找到同编号的成功流水 | 409 / `inventory_adjustment_rejected` | 首次提交且没有任何历史不确定结果时，在原尝试的浏览器互斥锁内立即结束该操作，再恢复可编辑草稿；已有未知结果或恢复中的操作仍保留原编号 |
| 数据库不可用、审计写入失败等未知错误 | 500 / 500 | 保留原操作编号和请求，恢复后重试或核实，不能当作确定未执行 |

相同编号的重放比较稳定的管理员账号 ID，而非显示名称。不同编号表示不同业务调整，即使参数相同也会分别执行；不要在超时后自动生成新编号。失败请求不会缓存为永久结果，但成功流水一经保存就能稳定重放。除首次确定拒绝的上述例外，只有收到并核对成功收据后才清理未确认操作；后续列表刷新失败与库存调整失败应分别处理。后台通过 Web Locks 串行同账号的跨标签页操作，不保留可延后使用的拒绝清除凭证；浏览器不支持锁或本地持久化失败时，暂停提交。

数据库沿用 `inventory_adjustments.id` 主键作为操作编号，普通 `INSERT`、库存触发器和成功审计处于同一事务。不能将该写入改成 `INSERT OR IGNORE` 或 `ON CONFLICT DO NOTHING`：`BEFORE INSERT` 触发器可能先改库存再忽略重复流水。唯一冲突必须回滚整个事务，随后查询并校验已经成功的同编号流水。

## 权限与订单流转

| 角色 | 主要权限 |
| --- | --- |
| owner 主管理员 | 全部模块，授权员工和设置店铺 |
| manager 运营主管 | 日常商品、订单、客户、营销、报表等 |
| operator 商品运营 | 商品、分类、库存、营销、内容、评价 |
| support 客服 | 订单、售后、客户、客服工单 |
| finance 财务 | 看订单及加备注、审核售后、报表、日志；不能演示确认、发货或取消 |

体验订单由“待付款 → 待发货 → 已发货 → 已完成”。待付款或待发货可取消，取消归还库存；并发取消只有一次成功，另一次返回 409，库存只归还一次。订单按创建时间保留 30 分钟，未付款且超时的订单在下一次商品目录、订单或相关后台接口请求时取消并释放库存。此机制由请求触发，不是后台定时任务。已发货或完成后不能直接取消，应走售后。演示确认只把 paymentStatus 记为 demo，**不表示款项到账**。售后审核通过也不会触发真实退款。

## 换成 Spring Boot + MySQL 时

1. 先实现安全的自有登录与服务端会话（例如 Spring Security）。用 HttpOnly、Secure、SameSite Cookie 保存会话；密码仅保存强散列。不可直接信任客户端请求头、前端角色字段或预览环境的 ChatGPT 身份。
2. 保持 /api/v1 路径与响应结构，逐项实现上面的接口；前端尽量继续使用 lib/api.ts。每个后台接口按当前角色重新鉴权，写操作保留 CSRF 或同源防护。
3. 将 products、skus、orders、order_items、admins、inventory_adjustments、audit_logs 等模型迁移到 MySQL。通用 records 可按业务拆表。D1/SQLite 的触发器和 SQL 不能直接拿到 MySQL 执行。
4. 订单创建、扣库存、取消与归还必须在事务中完成，并加幂等唯一约束与状态校验；支付回调还要验签、核金额和币种、去重。只在实际支付成功后更新正式付款状态。
5. 替换图片存储与访问地址；接入实际支付/退款、物流下单与轨迹、通知、税费发票、准点运行的订单超时调度、备份与监控，并通过完整验收后再开放真实交易。

当前 payments 与 webhooks 路径是预留入口，未配置时返回 503，不会执行交易。不要把体验订单直接解释为已付款订单。

## 新增字段与迁移

`drizzle/0002_commerce_guards.sql` 为规格增加 `image`，为订单增加 `expires_at`、`cancellation_reason`、`revision`，并在数据库中保护 SKU 归属、下单时的价格/状态校验和库存释放。迁移为已有待付款订单回填创建时间后 30 分钟的到期时间；应用新代码后，旧的超时订单会在相关请求中释放。测试覆盖从旧结构迁移，部署时仍需先备份并在目标测试环境验收。本次整改没有执行生产迁移。

`drizzle/0003_inventory_idempotency.sql` 仅为库存调整流水增加可空的 `actor_user_id`，新请求填写稳定管理员账号 ID。历史流水的 ID、操作者显示名称和库存保持不变，历史账号不做推测回填；这些历史流水不能被认领为新接口的重放请求。先执行迁移，再启用配套 API 与后台界面；旧页面若缺少 operationId 会收到 422，需要刷新。本次代码整改没有执行生产迁移。

店铺设置支持 `shopeeUrl`、`tiktokUrl`、`whatsappUrl`（空字符串或 HTTPS URL）、`contact` 和 `lowStock`。公开目录只返回顾客需要的设置；后台 bootstrap 返回店名和低库存阈值。未配置的平台链接不会变成示例商家链接；公开咨询窗口无需登录，站内留言仍需登录。WhatsApp 跳转和平台下单由相应外部网站处理。

已公开评价的 `reply` 会随目录返回。未审核评价和客户内部信息不在公开目录中返回。商品、订单更新冲突使用 HTTP 409，操作日志记录 `.conflict` 与 `outcome=conflict`，到期释放记录 `order.expire`。

## 验证与限制

开发和 CI 使用 Node.js 24.14.1、pnpm 11.25.0。保留仓库中的锁文件：

```sh
pnpm run install:ci
pnpm run typecheck
pnpm test
pnpm run lint
pnpm run build
```

`pnpm run verify` 顺序运行上述四项检查（不重新安装）。`install:ci` 在普通主机使用冻结锁文件安装，在 Sites 管理环境保留原有安装流程。`.github/workflows/commerce-checks.yml` 对 PR、main 和 codex 分支运行相同检查，不含部署步骤，也不需要生产凭证。

已有检查覆盖管理员隔离、首次绑定、商品与库存、服务端计价、优惠、订单幂等与归属、售后、评价、工单、角色和同源检查。它们不等于真实支付、物流、管理员首次激活和图片上传的生产验收。正式上线前需在目标部署环境逐项验证。
