# Mori Matcha API 与后端衔接

接口基址 `/api/v1`。此版包含可运行的 TypeScript / Workers 服务端与持久化数据，尚未实现 Java 服务端。前端请求集中在 `lib/api.ts`，未来可保留路径和数据结构，换为 Spring Boot + MySQL。

## 通用约定

- 金额统一使用整数分；示例 `1890` 代表 MYR 18.90。库存、购买数量均为整数。
- 成功：`{"success":true,"data":...}`。
- 失败：`{"success":false,"error":{"code":403,"message":"..."}}`。HTTP 使用 400、401、403、404、409、413、422、429、503 等状态。
- 当前认证由 Sites / ChatGPT 提供，管理权限在服务端 `admins` 表单独授权。普通账号登录后不会自动获得管理员权限。
- 每次管理请求均读取账号当前角色和启用状态。前端显示菜单不是授权依据。
- 写请求必须携带与本站一致的 Origin。迁移时采用同域 `/api` 反向代理，并保留 CSRF 防护；不要直接信任客户端传入的身份请求头。
- 当前预览所有订单 `isDemo=true`。不接收客户端总价，不收取真实款项。

## 公共与顾客接口

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/catalog` | 在售商品、启用 SKU、首页介绍、公开政策、运费方案、审核后的评价 |
| GET | `/session` | 当前账号、当前账号是否有管理权限 |
| POST | `/coupon/quote` | 预估优惠；下单仍重新校验 |
| GET / POST | `/orders` | 当前账号订单；创建测试订单 |
| POST | `/orders/{id}/cancel` | 当前账号取消自己的待付款订单 |
| POST | `/orders/{id}/aftersales` | 提交自己的订单售后申请 |
| GET | `/my/aftersales` | 当前账号的售后申请及处理结果 |
| GET / POST | `/my/addresses` | 当前账号收货地址读取、保存 |
| DELETE | `/my/addresses/{id}` | 删除自己的收货地址 |
| GET / POST | `/tickets` | 当前账号的客服留言与回复 |
| POST | `/reviews` | 已完成订单评价；默认待审核 |
| GET | `/media/{key}` | 已上传的商品图片 |

### 创建订单请求示例

```json
{
  "idempotencyKey": "请填写每次结算生成的UUID",
  "items": [{"skuId":"tin-50","quantity":1}],
  "customer": {
    "name":"测试收件人","phone":"00000000","email":"test@example.test",
    "address":"仅测试地址","city":"Test City","state":"Test State","postcode":"00000","note":""
  },
  "shippingId":"shipping-default",
  "coupon":"",
  "acknowledgeDemo":true
}
```

服务端读取售价、校验上架状态、合并重复 SKU、验证优惠与运费，再在同一数据库事务内创建订单及扣减库存。库存不足则整笔回滚。相同账号、相同幂等键返回同一订单；取消只归还一次库存。当前配送范围仅马来西亚，币种 MYR。

## 管理接口

| 方法 | 路径 | 权限 / 用途 |
| --- | --- | --- |
| POST | `/admin/activate` | 首次主管理员激活；需已登录及服务端激活码，首次绑定后不能由其他账号夺取 |
| GET | `/admin/bootstrap` | 当前管理员、角色与权限 |
| GET / POST / PATCH | `/admin/products` | 列表、新增、修改商品；PATCH 带 id 与 revision |
| GET / POST | `/admin/inventory` | 库存、调整流水；以 delta 正负数调整 |
| GET | `/admin/orders` | 订单列表 |
| PATCH | `/admin/orders/{id}` | 备注、演示确认、测试发货、测试完成、取消 |
| GET / POST | `/admin/records/{kind}` | 读取、新增通用业务记录 |
| PATCH / DELETE | `/admin/records/{kind}/{id}` | 更新；仅允许可删除类型删除 |
| GET / POST | `/admin/staff` | 员工角色与启停；仅主管理员 |
| POST | `/admin/uploads` | multipart/form-data 的 file 字段上传商品图 |
| GET | `/admin/reports` | 体验订单报表，真实营收固定为 0 |
| GET | `/admin/audit` | 操作记录 |
| GET | `/admin/integrations` | 外部服务连接状态 |

`kind` 允许 `categories`、`coupons`、`shipping`、`content`、`settings`、`customers`、`aftersales`、`reviews`、`tickets`。售后、评价、工单只接受处理已有记录，不允许管理端伪造顾客申请。首页介绍使用 `content/hero`。商品、订单与库存没有物理删除入口。

### 商品请求字段

`id`、`revision`、`name`、`nameEN`、`description`、`descriptionEN`、`category`、`images[]`、`detailImages[]`、`origin`、`storage`、`ingredients`、`status`、`variants[]`。

SKU 字段：`id`、`label`、`price`、`stock`、`active`。已有 SKU 的 stock 不通过商品编辑覆写，需调用库存调整接口。商品 revision 过期返回 409。新商品状态可为 draft；上架至少有一个启用规格。

图片最多主图 12 张、详情图 20 张；上传单张不超过 5 MiB。验证文件签名，只接受 PNG、JPEG、WebP、GIF，不允许 SVG、HTML；图片写入 R2，商品元数据写入 D1。

### 订单状态流转

`pending_payment → processing → shipped → completed`。

`pending_payment / processing → cancelled`，取消会归还库存。`confirm_demo` 仅对体验订单有效，paymentStatus 设置为 demo；它不代表实际收款。shipped / completed 不能直接取消，需走售后申请。售后审核通过也不会触发实际退款。

## 角色

| 角色 | 能力 |
| --- | --- |
| owner | 全部模块、员工授权与店铺设置；不能通过员工表单降级主管理员 |
| manager | 商品、库存、订单、售后、客户、营销、配送、内容、评价、客服、报表、日志 |
| operator | 商品、分类、库存、营销、内容、评价 |
| support | 订单、售后、客户、客服 |
| finance | 订单查看与备注、售后审核、报表、日志；不能发货、取消或演示确认订单 |

## Spring Boot + MySQL 迁移

前端页面可保留；用 Spring Controller 实现同名路径。`products`、`skus`、`orders`、`order_items`、`admins`、`inventory_adjustments`、`audit_logs` 是主要模型，通用 records 可拆成分类、优惠券、配送方案、客户、评价、售后、客服表。

正式后端应使用 Spring Security 与服务端会话，并在每个接口执行 RBAC。若采用自有账号密码，密码仅保存强密码散列，使用 HttpOnly / Secure / SameSite Cookie；不要将示例激活码或平台身份请求头当作自建服务器的认证方案。

库存处理迁移至 MySQL 事务：条件更新库存并检查影响行数；订单明细插入和库存扣减应属于同一事务。保留幂等唯一索引、状态校验与取消幂等性。当前 SQLite 触发器不能原样当作 MySQL SQL 使用。

下列为待实现的第三方接口占位，当前返回 503，不会执行交易：`POST /payments/intents`、`POST /payments/refunds`、`POST /webhooks/payments`、`POST /webhooks/logistics`。接通时必须验证回调签名、金额、币种与订单号，去重并使用状态机；支付成功以后才能转为实际待发货。

正式营业前还需接通实际收款和退款、快递下单及轨迹、发票与税费配置、通知、订单超时释放库存、备份恢复和生产监控。本项目是可操作的核心商城框架，不能视为这些外部服务已经接通。
