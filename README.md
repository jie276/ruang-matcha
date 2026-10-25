# Ruang Matcha

这个仓库有两个版本。**现在的商城与商家后台在 mori-matcha-commerce/；根目录 dist/ 是早期静态展示页。**

| 想做什么 | 入口 |
| --- | --- |
| 体验新版商城 | [打开私有预览](https://mori-matcha-commerce-jie.geniallily16.chatgpt.site/) |
| 管理商品、图片、价格和订单 | [商家后台登录页](https://mori-matcha-commerce-jie.geniallily16.chatgpt.site/admin/login) |
| 看店主操作步骤 | [商家使用说明](mori-matcha-commerce/docs/使用说明.md) |
| 让开发人员对接后端 | [接口与部署说明](mori-matcha-commerce/docs/API.md) |
| 浏览新版源码 | [mori-matcha-commerce/](mori-matcha-commerce/) |

预览站目前是私有的。商城没有商家后台按钮；只有获得站点访问权限并且被授权的管理员账号才能进后台。第一次绑定主管理员还需要单独交付的激活码。

新版可在后台改商品名称、介绍、价格、主图、详情图和规格，也有库存、体验订单、售后、客户、优惠、配送、内容、评价、客服、报表、员工权限和日志。**体验订单不会真实收款、退款或下快递单。** 上传到 GitHub 只是保存源码，不会自动更新已经发布的预览站。正式营业前还需接通支付、物流等服务；现状和步骤见上面的说明。

## 早期静态版本

dist/index.html 是原来的双语商品展示页；dist/review.html 用于电脑、平板、手机尺寸预览；dist/config.js 放店铺及商品目标链接；dist/styles.css 和 dist/app.js 分别是样式和交互。这个早期版本没有商家后台或交易后端。商品图只做格式压缩，图中商品与文字未改；图示的 50g、100g 规格在正式使用前仍需核实。URW Base35 的 P052 字体子集、转换脚本和 AGPL-3 字体许可证保存在 assets 中。
