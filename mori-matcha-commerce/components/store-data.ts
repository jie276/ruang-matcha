import type { Product, Variant } from "@/lib/model";
import type { Language } from "./store-copy";

export type Category = {
  id: string;
  name: string;
  nameEN?: string;
  nameMS?: string;
  status: string;
};
export type Shipping = {
  id: string;
  name: string;
  fee: number;
  freeAbove: number;
};
export type Review = {
  id: string;
  productId: string;
  rating: number;
  text: string;
  reply?: string;
};
export type Settings = {
  name?: string;
  announcement?: string;
  contact?: string;
  returnsPolicy?: string;
  privacyPolicy?: string;
  shopeeUrl?: string;
  tiktokUrl?: string;
  whatsappUrl?: string;
};
export type Hero = {
  title: string;
  titleEN?: string;
  titleMS?: string;
  description: string;
  descriptionEN?: string;
  descriptionMS?: string;
  image: string;
  enabled?: boolean;
};
export type Catalog = {
  products: Product[];
  categories: Category[];
  hero: Hero;
  shipping: Shipping[];
  ready: boolean;
  reviews: Review[];
  settings?: Settings;
};
export type Session = { user: { email?: string } | null };
export type CartEntry = { skuId: string; quantity: number };
export type CartItem = CartEntry & { product: Product; variant: Variant };
export type OrderItem = {
  skuId: string;
  productId: string;
  name: string;
  label: string;
  quantity: number;
  price: number;
};
export type Order = {
  id: string;
  status: string;
  createdAt: string;
  total: number;
  items: OrderItem[];
  carrier?: string;
  tracking?: string;
  expiresAt?: string;
  cancellationReason?: string;
  idempotencyKey?: string;
};
export type Aftersale = {
  id: string;
  orderId: string;
  status: string;
  reply?: string;
};
export type Address = {
  id: string;
  name: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  postcode: string;
};
export type Ticket = {
  id: string;
  subject: string;
  message: string;
  reply?: string;
};

export const localized = (
  language: Language,
  original: string,
  english?: string,
  malay?: string,
) =>
  language === "ms"
    ? malay || english || original
    : language === "en"
      ? english || original
      : original;

export const variantImage = (product: Product, variant?: Variant) =>
  variant?.image || product.images[0] || "";

export function platformUrl(value?: string) {
  if (!value) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : "";
  } catch {
    return "";
  }
}

export function publicProducts(products: Product[], categories: Category[]) {
  const activeCategories = new Set(
    categories
      .filter((category) => category.status === "active")
      .map((category) => category.id),
  );
  return products
    .filter(
      (product) =>
        product.status === "active" && activeCategories.has(product.category),
    )
    .map((product) => ({
      ...product,
      variants: product.variants.filter((variant) => variant.active !== 0),
    }))
    .filter((product) => product.variants.length > 0);
}

export function storedCart(value: unknown): CartEntry[] {
  if (!Array.isArray(value)) return [];
  const quantities = new Map<string, number>();
  for (const item of value) {
    if (
      typeof item !== "object" ||
      item === null ||
      typeof item.skuId !== "string" ||
      !Number.isInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > 100
    )
      continue;
    quantities.set(
      item.skuId,
      Math.min(100, (quantities.get(item.skuId) || 0) + item.quantity),
    );
  }
  return [...quantities].map(([skuId, quantity]) => ({ skuId, quantity }));
}

export function restoredCheckoutKey(value: unknown, cart: CartEntry[]): string {
  if (
    typeof value !== "object" ||
    value === null ||
    !("key" in value) ||
    !("cart" in value)
  )
    return "";
  return typeof value.key === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value.key,
    ) &&
    value.cart === JSON.stringify(cart)
    ? value.key
    : "";
}
