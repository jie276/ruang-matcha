# Ruang Matcha · 抹茶商品网页初稿

双语静态商品展示网页，使用提供的罐装与袋装两张商品图。

- `dist/index.html`：访客页面，所有设备均逐件纵向展示商品。
- `dist/review.html`：切换电脑、平板、手机尺寸的设计预览。
- `dist/config.js`：店铺入口、罐装商品、袋装商品的独立 HTTPS 目标链接；当前未提供时显示预览提示。
- `dist/styles.css`：响应式视觉样式、减少动态效果适配。
- `dist/app.js`：导航、商品图放大、规格预览、链接提示与滚动动画。

商品图片只做格式压缩，未改动图中商品及文字。50g 和 100g 来自图片标注，正式使用前仍需核实。页面未新增认证、产地、等级、营养功效或配送时效承诺。

上线前：替换临时品牌名称、核对产品与图片信息、提供店铺和两件商品的实际链接，再逐个验证目标。规格切换只用于预览，不替顾客选择 TikTok 内的购买规格。

字体使用 URW Base35 的 P052 子集。原始字体、转换脚本及 AGPL-3 字体许可证保存在 assets 中。


## Mori Matcha 商城与后台

新版商城源码位于 [`mori-matcha-commerce/`](mori-matcha-commerce/)；包含商品管理、订单、库存、售后与管理员权限，以及 [使用说明](mori-matcha-commerce/docs/使用说明.md) 和 [API 对接文档](mori-matcha-commerce/docs/API.md)。根目录的 `dist/` 保留早期静态展示版本。
