# Mori Matcha Commerce

铜仁抹茶商城与独立商家后台。保留原页面的品牌视觉，增加持久化业务接口与权限控制。

- 前台：`/`
- 后台：`/admin`
- 首次登录：`/admin/login`
- API：`/api/v1`

使用说明：[docs/使用说明.md](docs/使用说明.md)

接口与 Spring Boot / MySQL 对接：[docs/API.md](docs/API.md)

## 开发与验证

使用 Sites 提供的依赖安装与构建工作流。`node scripts/test-commerce.mjs` 运行控制器集成检查；`node node_modules/typescript/bin/tsc --noEmit` 检查类型。

D1 绑定 `DB`，R2 绑定 `BUCKET`；服务端环境变量 `ADMIN_ACTIVATION_CODE` 用于首次绑定。不得提交真实激活码、账号口令或密钥。当前所有订单均为体验订单，未接入真实收款、退款、快递下单和税费发票。
