export type Variant = {
  id: string;
  label: string;
  price: number;
  stock: number;
  active?: number;
  /** Empty or absent values use the product's first image. */
  image?: string;
};

export type Product = {
  id: string;
  name: string;
  nameEN: string;
  nameMS?: string;
  description: string;
  descriptionEN: string;
  descriptionMS?: string;
  category: string;
  images: string[];
  detailImages: string[];
  origin: string;
  storage: string;
  ingredients: string;
  status: string;
  revision: number;
  variants: Variant[];
};

export const sampleProducts: Product[] = [
  {
    id: "matcha-tin",
    name: "铜仁抹茶 · 轻享罐装",
    nameEN: "Tongren Matcha · Daily Tin",
    description:
      "选用贵州铜仁茶叶。适合为日常饮品添一抹绿意，按个人口味调配浓淡。",
    descriptionEN:
      "Made with tea leaves from Tongren, Guizhou. A little green for your everyday cup. Adjust to your own taste.",
    category: "tin",
    images: ["/assets/tin.jpg"],
    detailImages: [],
    origin: "中国 · 贵州铜仁",
    storage: "请以包装标示为准，开封后密封避光保存。",
    ingredients: "请以商品实际包装配料表为准。",
    status: "active",
    revision: 1,
    variants: [
      {
        id: "tin-50",
        label: "50g",
        price: 1890,
        stock: 42,
        active: 1,
        image: "/assets/tin.jpg",
      },
    ],
  },
  {
    id: "matcha-pouch",
    name: "铜仁抹茶 · 日常袋装",
    nameEN: "Tongren Matcha · Everyday Pouch",
    description:
      "从贵州铜仁的茶叶开始，让一杯抹茶融入日常。可尝试制作拿铁、冰饮或烘焙。",
    descriptionEN:
      "Tea leaves from Tongren, Guizhou, for a gentle daily ritual. Try it in a latte, an iced drink or a weekend bake.",
    category: "pouch",
    images: ["/assets/pouch50.jpg", "/assets/pouch100.jpg"],
    detailImages: [],
    origin: "中国 · 贵州铜仁",
    storage: "请以包装标示为准，开封后密封避光保存。",
    ingredients: "请以商品实际包装配料表为准。",
    status: "active",
    revision: 1,
    variants: [
      {
        id: "pouch-50",
        label: "50g",
        price: 1690,
        stock: 68,
        active: 1,
        image: "/assets/pouch50.jpg",
      },
      {
        id: "pouch-100",
        label: "100g",
        price: 2990,
        stock: 31,
        active: 1,
        image: "/assets/pouch100.jpg",
      },
    ],
  },
];

export const defaultHero = {
  id: "hero",
  title: "把铜仁的绿意，\n泡进日常。",
  titleEN: "A little Tongren.\nA softer kind of green.",
  titleMS: "",
  description:
    "Mori Matcha 选用贵州铜仁茶叶，让来自家乡的茶香，成为忙碌生活里的一小段从容。无论是晨间的一杯抹茶，还是午后的拿铁与烘焙，都可以按自己的节奏，调出喜欢的味道。",
  descriptionEN:
    "Made with tea leaves from Tongren, Guizhou. Mori Matcha brings a little green pause to your day — from your morning cup to a homemade latte or a weekend bake.",
  descriptionMS: "",
  image: "/assets/pair.jpg",
  enabled: true,
};

export const statusLabels: Record<string, string> = {
  pending_payment: "待付款",
  processing: "待发货",
  shipped: "已发货",
  completed: "已完成",
  cancelled: "已取消",
  requested: "待处理",
  approved: "已同意申请",
  rejected: "已拒绝",
  closed: "已关闭",
  active: "已启用",
  draft: "草稿",
  archived: "已下架",
  disabled: "已停用",
  pending: "待审核",
  published: "已公开",
  demo: "演示确认",
  unpaid: "未付款",
};

export const roles: Record<string, string[]> = {
  owner: ["*"],
  manager: [
    "products",
    "categories",
    "inventory",
    "orders",
    "aftersales",
    "customers",
    "coupons",
    "shipping",
    "content",
    "reviews",
    "tickets",
    "reports",
    "audit",
  ],
  operator: [
    "products",
    "categories",
    "inventory",
    "coupons",
    "content",
    "reviews",
  ],
  support: ["orders", "aftersales", "customers", "tickets"],
  finance: ["orders", "aftersales", "reports", "audit"],
};

export const money = (amount: number) =>
  "RM " + (Number(amount) / 100).toFixed(2);
