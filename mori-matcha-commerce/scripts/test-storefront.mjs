import assert from "node:assert/strict";
import { getCopy, isLanguage, orderStatus } from "../components/store-copy.ts";
import {
  localized,
  platformUrl,
  publicProducts,
  restoredCheckoutKey,
  storedCart,
  variantImage,
} from "../components/store-data.ts";

const categories = [
  {
    id: "ceremony",
    name: "茶会系列",
    nameEN: "Ceremony",
    nameMS: "Majlis teh",
    status: "active",
  },
  { id: "hidden", name: "隐藏分类", status: "disabled" },
];
const product = {
  id: "tea",
  name: "抹茶",
  nameEN: "Matcha",
  nameMS: "Matcha majlis",
  description: "",
  descriptionEN: "",
  category: "ceremony",
  images: ["/shared.jpg"],
  detailImages: [],
  origin: "",
  storage: "",
  ingredients: "",
  status: "active",
  revision: 1,
  variants: [
    {
      id: "small",
      label: "50g",
      price: 1000,
      stock: 7,
      active: 1,
      image: "/small.jpg",
    },
    {
      id: "large",
      label: "100g",
      price: 2000,
      stock: 4,
      active: 1,
      image: "/large.jpg",
    },
    { id: "retired", label: "250g", price: 4000, stock: 12, active: 0 },
  ],
};
const source = [
  product,
  { ...product, id: "hidden-category", category: "hidden" },
  { ...product, id: "missing-category", category: "missing" },
  { ...product, id: "draft", status: "draft" },
];
const snapshot = JSON.stringify(source);
const visible = publicProducts(source, categories);
assert.deepEqual(
  visible.map((item) => item.id),
  ["tea"],
  "disabled, missing and draft catalog entries must never be purchasable",
);
assert.deepEqual(
  visible[0].variants.map((item) => item.id),
  ["small", "large"],
  "retired SKUs must stay out of the public catalog",
);
assert.equal(
  JSON.stringify(source),
  snapshot,
  "public filtering must not change stored prices, stock or publication state",
);
assert.equal(
  localized(
    "ms",
    categories[0].name,
    categories[0].nameEN,
    categories[0].nameMS,
  ),
  "Majlis teh",
  "custom category names must not become pouch/tin labels",
);
assert.equal(
  localized("ms", product.name, product.nameEN),
  "Matcha",
  "older products need an explicit English fallback",
);
assert.equal(
  variantImage(product, product.variants[1]),
  "/large.jpg",
  "a 100g selection must use its own bound image",
);
assert.equal(
  variantImage(product, { ...product.variants[1], image: "" }),
  "/shared.jpg",
  "unconfigured SKU images must use the shared product image",
);
assert.equal(
  platformUrl("https://shop.example/matcha"),
  "https://shop.example/matcha",
);
for (const url of [
  "",
  "javascript:alert(1)",
  "data:text/html,hello",
  "http://shop.example",
  "https://user:password@shop.example",
]) {
  assert.equal(
    platformUrl(url),
    "",
    "missing or unsafe external links must remain unavailable",
  );
}
assert.deepEqual(
  storedCart([
    { skuId: "small", quantity: 2 },
    { skuId: "small", quantity: 3 },
    { skuId: "large", quantity: -1 },
    null,
    { quantity: 2 },
  ]),
  [{ skuId: "small", quantity: 5 }],
  "persisted cart entries must be validated and duplicate SKU quantities combined",
);
const retryCart = [{ skuId: "small", quantity: 2 }];
const checkoutAttempt = {
  key: "01234567-89ab-cdef-0123-456789abcdef",
  cart: JSON.stringify(retryCart),
};
assert.equal(
  restoredCheckoutKey(checkoutAttempt, retryCart),
  checkoutAttempt.key,
  "reloading the same bag must preserve the key after an uncertain order response",
);
assert.equal(
  restoredCheckoutKey(checkoutAttempt, [{ skuId: "small", quantity: 3 }]),
  "",
  "an explicitly changed bag must not reuse an older order key",
);
assert.equal(
  restoredCheckoutKey(
    { key: "invalid", cart: JSON.stringify(retryCart) },
    retryCart,
  ),
  "",
);
assert.equal(isLanguage("ms"), true);
assert.equal(isLanguage("__proto__"), false);
for (const language of ["zh", "en", "ms"]) {
  assert.deepEqual(
    Object.keys(getCopy(language)).sort(),
    Object.keys(getCopy("zh")).sort(),
    `all customer actions need ${language} labels`,
  );
}
assert.equal(getCopy("ms").placeOrder, "Hantar pesanan ujian");
assert.equal(orderStatus("pending_payment", "ms"), "Menunggu bayaran");
assert.equal(orderStatus("cancelled", "ms"), "Dibatalkan");
console.log("Storefront regression checks passed.");
