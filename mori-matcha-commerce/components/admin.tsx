"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  Leaf,
  LayoutDashboard,
  Package,
  ShoppingCart,
  Boxes,
  Undo2,
  Users,
  TicketPercent,
  Truck,
  FileImage,
  Star,
  MessageSquare,
  BarChart3,
  ShieldCheck,
  Settings,
  ScrollText,
  LogOut,
  ArrowUpRight,
  Plus,
  Search,
  Download,
  RefreshCw,
  Menu,
  X,
  CheckCircle2,
  ImagePlus,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { api } from "@/lib/api";
import { money, statusLabels, type Product, type Variant } from "@/lib/model";
import Modal from "./modal";
import AdminInventoryAdjustment, {
  type InventorySelection,
} from "./admin-inventory";

type ModuleId =
  | "dashboard"
  | "products"
  | "categories"
  | "inventory"
  | "orders"
  | "aftersales"
  | "customers"
  | "coupons"
  | "shipping"
  | "content"
  | "reviews"
  | "tickets"
  | "reports"
  | "staff"
  | "audit"
  | "settings";
type RecordValue = string | number | boolean | undefined;
type AdminRecord = Record<string, RecordValue>;
type ProductDraft = Omit<Product, "id" | "revision"> & {
  id?: string;
  revision?: number;
};
type StoreSettings = { name: string; lowStock: number };
type Bootstrap = {
  permissions: string[];
  admin: { name: string; role: string; userId: string };
  orderCount: number;
  settings?: StoreSettings;
};
type Order = {
  id: string;
  status: string;
  paymentStatus: string;
  total: number;
  subtotal: number;
  discount: number;
  shippingFee: number;
  coupon?: string;
  createdAt: string;
  carrier?: string;
  tracking?: string;
  note?: string;
  expiresAt?: string;
  cancellationReason?: string;
  customer: Record<string, string>;
  items: {
    skuId: string;
    name: string;
    label: string;
    image: string;
    quantity: number;
    price: number;
  }[];
};
type Inventory = {
  products: Product[];
  events: {
    id: string;
    skuId: string;
    delta: number;
    reason: string;
    actor: string;
    createdAt: string;
  }[];
  lowStock?: number;
};
type Report = {
  total: number;
  count: number;
  realRevenue: number;
  orders: Order[];
};
type Overview = {
  orders: Order[];
  products: Product[];
  aftersales: AdminRecord[];
};
type Field = readonly [
  key: string,
  label: string,
  type?:
    | "select"
    | "money"
    | "datetime"
    | "textarea"
    | "image"
    | "checkbox"
    | "number"
    | "url",
  options?: string,
];

const modules: [ModuleId, string, LucideIcon][] = [
  ["dashboard", "经营概览", LayoutDashboard],
  ["products", "商品管理", Package],
  ["categories", "商品分类", Boxes],
  ["inventory", "库存管理", Boxes],
  ["orders", "订单管理", ShoppingCart],
  ["aftersales", "售后管理", Undo2],
  ["customers", "客户管理", Users],
  ["coupons", "优惠营销", TicketPercent],
  ["shipping", "配送运费", Truck],
  ["content", "首页介绍", FileImage],
  ["reviews", "评价审核", Star],
  ["tickets", "客服工单", MessageSquare],
  ["reports", "财务报表", BarChart3],
  ["staff", "员工权限", ShieldCheck],
  ["audit", "操作日志", ScrollText],
  ["settings", "店铺设置", Settings],
];
const endpoints: Partial<Record<ModuleId, string>> = {
  products: "/admin/products",
  inventory: "/admin/inventory",
  orders: "/admin/orders",
  reports: "/admin/reports",
  audit: "/admin/audit",
  staff: "/admin/staff",
};
const fieldConfig: Partial<Record<ModuleId, readonly Field[]>> = {
  categories: [
    ["name", "分类名称"],
    ["nameEN", "英文名称"],
    ["nameMS", "马来文名称"],
    ["status", "状态", "select", "active,disabled"],
  ],
  coupons: [
    ["name", "活动名称"],
    ["code", "优惠码"],
    ["discount", "优惠金额 (RM)", "money"],
    ["minimum", "最低订单金额 (RM)", "money"],
    ["expires", "到期时间", "datetime"],
    ["status", "状态", "select", "active,disabled"],
  ],
  shipping: [
    ["name", "配送方案"],
    ["fee", "运费 (RM)", "money"],
    ["freeAbove", "免运费门槛 (RM)，0 为不免", "money"],
    ["countries", "国家代码 (当前仅支持 MY)"],
    ["status", "状态", "select", "active,disabled"],
  ],
  content: [
    ["title", "首页中文标题，换行显示", "textarea"],
    ["titleEN", "英文标题", "textarea"],
    ["titleMS", "马来文标题", "textarea"],
    ["description", "中文介绍", "textarea"],
    ["descriptionEN", "英文介绍", "textarea"],
    ["descriptionMS", "马来文介绍", "textarea"],
    ["image", "首页商品介绍图", "image"],
    ["enabled", "启用首页介绍", "checkbox"],
  ],
  settings: [
    ["name", "店铺名称"],
    ["currency", "币种 (MYR)"],
    ["contact", "公开客服联系方式"],
    ["whatsappUrl", "WhatsApp 咨询链接 (HTTPS)", "url"],
    ["shopeeUrl", "Shopee 购买链接 (HTTPS)", "url"],
    ["tiktokUrl", "TikTok Shop 购买链接 (HTTPS)", "url"],
    ["lowStock", "低库存阈值，0 为不提醒", "number"],
    ["announcement", "顶部公告"],
    ["returnsPolicy", "售后政策", "textarea"],
    ["privacyPolicy", "隐私政策", "textarea"],
  ],
  customers: [
    ["name", "姓名"],
    ["email", "邮箱"],
    ["userId", "账号 ID"],
    ["tags", "客户标签，用逗号分隔"],
    ["note", "内部备注", "textarea"],
    ["status", "账号状态", "select", "active,disabled"],
  ],
  aftersales: [
    ["status", "审核状态", "select", "requested,approved,rejected,closed"],
    ["reply", "处理说明，顾客可见", "textarea"],
  ],
  reviews: [
    ["status", "审核状态", "select", "pending,published,rejected"],
    ["reply", "商家回复，公开评价中顾客可见", "textarea"],
  ],
  tickets: [
    ["status", "处理状态", "select", "requested,closed"],
    ["reply", "客服回复，顾客可见", "textarea"],
  ],
  staff: [
    ["userId", "账号 ID (由员工登录页获取)"],
    ["email", "邮箱"],
    ["name", "员工名称"],
    ["role", "角色", "select", "manager,operator,support,finance"],
    ["active", "账号状态", "select", "1,0"],
  ],
};
const genericTabs: ModuleId[] = [
  "categories",
  "aftersales",
  "customers",
  "coupons",
  "shipping",
  "content",
  "reviews",
  "tickets",
  "staff",
];
const roleNames: Record<string, string> = {
  owner: "主管理员",
  manager: "运营主管",
  operator: "商品运营",
  support: "客服",
  finance: "财务",
};
const optionalFields = new Set([
  "nameEN",
  "nameMS",
  "contact",
  "reply",
  "note",
  "tags",
  "announcement",
  "whatsappUrl",
  "shopeeUrl",
  "tiktokUrl",
]);
const endpoint = (tab: ModuleId) => endpoints[tab] || "/admin/records/" + tab;
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "操作失败，请稍后重试";
const textValue = (value: RecordValue) => (value == null ? "" : String(value));
const hasPermission = (boot: Bootstrap | null, permission: string) =>
  !!boot?.permissions.some((value) => value === "*" || value === permission);

function csv(rows: object[], name: string) {
  if (!rows.length) return;
  const keys = Object.keys(rows[0]);
  const cell = (value: unknown) =>
    '"' +
    String(typeof value === "object" ? JSON.stringify(value) : (value ?? ""))
      .replace(/^[\s]*[=+@-]/, "'$&")
      .replace(/"/g, '""') +
    '"';
  const content =
    "\ufeff" +
    [
      keys.map(cell).join(","),
      ...rows.map((row) =>
        keys
          .map((key) => cell((row as Record<string, unknown>)[key]))
          .join(","),
      ),
    ].join("\r\n");
  const url = URL.createObjectURL(
    new Blob([content], { type: "text/csv;charset=utf-8" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name + ".csv";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Admin() {
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [tab, setTab] = useState<ModuleId>("dashboard");
  const [loadedTab, setLoadedTab] = useState<ModuleId | null>(null);
  const [records, setRecords] = useState<AdminRecord[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [inventory, setInventory] = useState<Inventory>({
    products: [],
    events: [],
  });
  const [report, setReport] = useState<Report>({
    total: 0,
    count: 0,
    realRevenue: 0,
    orders: [],
  });
  const [overview, setOverview] = useState<Overview | null>(null);
  const [categories, setCategories] = useState<AdminRecord[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<AdminRecord | null>(null);
  const [product, setProduct] = useState<ProductDraft | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [stock, setStock] = useState<InventorySelection | null>(null);
  const [mobile, setMobile] = useState(false);
  const loadVersion = useRef(0);
  const mutationInFlight = useRef(false);
  const can = (permission: string) => hasPermission(boot, permission);
  const storeName = boot?.settings?.name || "Mori Matcha";
  const lowStock = boot?.settings?.lowStock ?? 10;
  const title = modules.find((module) => module[0] === tab)?.[1] || "";

  const load = useCallback(async (selected: ModuleId) => {
    const version = ++loadVersion.current;
    let bootstrapped = false;
    try {
      const bootstrap = await api<Bootstrap>("/admin/bootstrap");
      if (version !== loadVersion.current) return;
      setBoot(bootstrap);
      setError("");
      bootstrapped = true;
      if (selected === "dashboard") {
        const [nextOrders, nextProducts, aftersales] = await Promise.all([
          hasPermission(bootstrap, "orders")
            ? api<Order[]>("/admin/orders")
            : Promise.resolve([]),
          hasPermission(bootstrap, "products")
            ? api<Product[]>("/admin/products")
            : Promise.resolve([]),
          hasPermission(bootstrap, "aftersales")
            ? api<AdminRecord[]>("/admin/records/aftersales")
            : Promise.resolve([]),
        ]);
        if (version === loadVersion.current)
          setOverview({
            orders: nextOrders,
            products: nextProducts,
            aftersales,
          });
      } else if (selected === "products") {
        const [nextProducts, nextCategories] = await Promise.all([
          api<Product[]>(endpoint(selected)),
          api<AdminRecord[]>("/admin/records/categories"),
        ]);
        if (version === loadVersion.current) {
          setProducts(nextProducts);
          setCategories(nextCategories);
        }
      } else {
        const result = await api(endpoint(selected));
        if (version !== loadVersion.current) return;
        if (selected === "orders") setOrders(result as Order[]);
        else if (selected === "inventory") setInventory(result as Inventory);
        else if (selected === "reports") setReport(result as Report);
        else setRecords(result as AdminRecord[]);
      }
      if (version === loadVersion.current) setLoadedTab(selected);
    } catch (reason) {
      if (version !== loadVersion.current) return;
      const statusCode =
        reason instanceof Error && "status" in reason
          ? reason.status
          : undefined;
      if (statusCode === 401 || (statusCode === 403 && !bootstrapped)) {
        location.href = "/admin/login";
        return;
      }
      setError(errorMessage(reason));
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    // Discard the development StrictMode setup before starting its request.
    void Promise.resolve().then(() => {
      if (active) return load("dashboard");
    });
    return () => {
      active = false;
      loadVersion.current += 1;
    };
  }, [load]);

  function switchTab(next: ModuleId) {
    setTab(next);
    setQuery("");
    setStatus("all");
    setMobile(false);
    setLoading(true);
    setLoadedTab(null);
    setError("");
    void load(next);
  }

  async function run(action: () => Promise<void>) {
    if (mutationInFlight.current) return;
    mutationInFlight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice("已保存，变更已同步");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      mutationInFlight.current = false;
      setBusy(false);
    }
  }

  function newProduct() {
    setProduct({
      name: "",
      nameEN: "",
      nameMS: "",
      description: "",
      descriptionEN: "",
      descriptionMS: "",
      category: "",
      images: [],
      detailImages: [],
      origin: "",
      ingredients: "",
      storage: "",
      status: "draft",
      variants: [
        {
          id: crypto.randomUUID(),
          label: "",
          price: 0,
          stock: 0,
          active: 0,
          image: "",
        },
      ],
    });
  }

  function newRecord() {
    setEditing({
      name: "",
      nameEN: "",
      nameMS: "",
      status: "active",
      discount: 0,
      minimum: 0,
      fee: 0,
      freeAbove: 0,
      countries: "MY",
      expires: new Date(Date.now() + 30 * 86400000).toISOString(),
      active: 1,
      role: "operator",
    });
  }

  async function saveRecord(next: AdminRecord) {
    if (!editing) return;
    if (tab === "customers") next.userId = editing.userId;
    if (editing.revision !== undefined) next.revision = editing.revision;
    if (tab === "shipping" && next.countries !== "MY")
      throw new Error("当前结算仅支持马来西亚 MY");
    await api(
      tab === "staff"
        ? "/admin/staff"
        : endpoint(tab) + (editing.id ? "/" + editing.id : ""),
      tab === "staff" ? "POST" : editing.id ? "PATCH" : "POST",
      next,
    );
    setEditing(null);
    await load(tab);
  }

  const matches = (row: object & { status?: RecordValue }) =>
    JSON.stringify(row).toLowerCase().includes(query.toLowerCase()) &&
    (status === "all" || row.status === status);
  const filteredProducts = products.filter(matches);
  const filteredOrders = orders.filter(matches);
  const filteredRecords = records.filter(matches);
  const rows =
    tab === "products" ? products : tab === "orders" ? orders : records;
  const filtered =
    tab === "products"
      ? filteredProducts
      : tab === "orders"
        ? filteredOrders
        : filteredRecords;

  return (
    <div className="mm-admin">
      <aside className={"mm-admin-sidebar " + (mobile ? "open" : "")}>
        <a className="mm-admin-brand" href="/admin">
          <span className="brand-mark">
            <Leaf size={23} />
          </span>
          <span>
            {storeName}
            <small>SELLER CENTRE</small>
          </span>
        </a>
        <div className="mm-sidebar-caption">店铺工作台</div>
        <nav>
          {modules
            .filter(([id]) => id === "dashboard" || can(id))
            .map(([id, label, Icon]) => (
              <button
                key={id}
                className={tab === id ? "active" : ""}
                disabled={busy}
                onClick={() => switchTab(id)}
              >
                <Icon size={17} />
                {label}
                {id === "orders" && (boot?.orderCount ?? 0) > 0 && (
                  <small>{boot?.orderCount}</small>
                )}
              </button>
            ))}
        </nav>
        <div className="mm-sidebar-bottom">
          <a href="/" target="_blank" rel="noreferrer">
            查看商城 <ArrowUpRight size={15} />
          </a>
          <a
            href="/signout-with-chatgpt?return_to=%2Fadmin%2Flogin"
            target="_top"
          >
            <LogOut size={15} />
            退出登录
          </a>
        </div>
      </aside>
      {mobile && (
        <button
          className="mm-sidebar-shade"
          aria-label="关闭菜单"
          onClick={() => setMobile(false)}
        />
      )}
      <div className="mm-admin-work">
        <header className="mm-admin-top">
          <div>
            <button
              className="mm-icon mm-mobile-menu"
              onClick={() => setMobile(!mobile)}
              aria-label="菜单"
            >
              <Menu size={20} />
            </button>
            <span>工作台 / {title}</span>
          </div>
          <div className="mm-admin-user">
            <span className="mm-avatar">
              {boot?.admin.name?.[0]?.toUpperCase() || "M"}
            </span>
            <div>
              <strong>{boot?.admin.name || "正在加载…"}</strong>
              <small>{roleNames[boot?.admin.role || ""]}</small>
            </div>
            <ShieldCheck size={17} />
          </div>
        </header>
        <main className="mm-admin-main">
          <div className="mm-admin-heading">
            <div>
              <p className="section-kicker">
                {storeName} · {tab.toUpperCase()}
              </p>
              <h1>
                {tab === "dashboard" ? "今天，也认真经营一份绿意。" : title}
              </h1>
              <p>
                {tab === "dashboard"
                  ? "从商品到每一笔订单，在这里有序管理。"
                  : "管理你的" + title + "，所有变更通过服务端权限验证。"}
              </p>
            </div>
            <button
              className="mm-btn light"
              disabled={loading || busy}
              onClick={() => {
                setLoading(true);
                void load(tab);
              }}
            >
              <RefreshCw size={15} />
              刷新
            </button>
          </div>
          <div className="mm-demo-banner">
            <span className="mm-badge">体验环境</span>
            订单、库存与设置会持久保存。支付、退款及快递下单尚未接入，体验订单不会产生真实款项。
          </div>
          {error && (
            <div className="mm-error" role="alert">
              {error}
            </div>
          )}
          {notice && (
            <div className="mm-good" role="status">
              <CheckCircle2 size={16} />
              {notice}
            </div>
          )}
          {boot && can("inventory") && (
            <AdminInventoryAdjustment
              key={boot.admin.userId}
              userId={boot.admin.userId}
              stock={stock}
              onClose={() => setStock(null)}
              onConfirmed={async () => {
                setStock(null);
                await load(tab);
              }}
            />
          )}
          {loading ? (
            <div className="mm-admin-loading">
              <Leaf size={28} />
              <p>正在载入工作台…</p>
            </div>
          ) : loadedTab !== tab ? null : (
            <>
              {tab === "dashboard" && overview && (
                <>
                  <div className="mm-stats">
                    {[
                      [
                        "体验订单金额",
                        money(
                          overview.orders
                            .filter((item) => item.status !== "cancelled")
                            .reduce((sum, item) => sum + item.total, 0),
                        ),
                        "不计为真实营收",
                      ],
                      ["全部订单", overview.orders.length, "服务端记录"],
                      [
                        "待发货",
                        overview.orders.filter(
                          (item) => item.status === "processing",
                        ).length,
                        "演示确认后的订单",
                      ],
                      [
                        "在售商品",
                        overview.products.filter(
                          (item) => item.status === "active",
                        ).length,
                        "可在前台浏览",
                      ],
                    ].map(([label, value, note]) => (
                      <div key={label} className="mm-stat">
                        <span>{label}</span>
                        <strong>{value}</strong>
                        <small>{note}</small>
                      </div>
                    ))}
                  </div>
                  <div className="mm-dash-grid">
                    <section className="mm-panel">
                      <div className="mm-panel-head">
                        <h2>待办事项</h2>
                        <span>实时汇总</span>
                      </div>
                      {(
                        [
                          [
                            "orders",
                            "待处理订单",
                            overview.orders.filter(
                              (item) => item.status === "pending_payment",
                            ).length,
                          ],
                          [
                            "aftersales",
                            "待审核售后",
                            overview.aftersales.filter(
                              (item) => item.status === "requested",
                            ).length,
                          ],
                          [
                            "inventory",
                            lowStock === 0
                              ? "低库存提醒已关闭"
                              : `库存低于 ${lowStock} 的启用规格`,
                            overview.products
                              .flatMap((item) => item.variants)
                              .filter(
                                (item) =>
                                  item.active !== 0 && item.stock < lowStock,
                              ).length,
                          ],
                        ] as [ModuleId, string, number][]
                      ).map(([id, label, count]) => (
                        <button
                          className="mm-todo"
                          key={id}
                          disabled={!can(id)}
                          onClick={() => switchTab(id)}
                        >
                          <span>{label}</span>
                          <strong>{count}</strong>
                          <ArrowUpRight size={16} />
                        </button>
                      ))}
                    </section>
                    <section className="mm-panel">
                      <div className="mm-panel-head">
                        <h2>店铺准备</h2>
                        <Leaf size={18} />
                      </div>
                      <p className="mm-muted">
                        商品图、中文、英文与马来文介绍、售价、规格、运费和售后政策，都可在工作台维护。
                      </p>
                      <div className="mm-actions">
                        {can("products") && (
                          <button
                            className="mm-btn"
                            onClick={() => switchTab("products")}
                          >
                            管理商品
                          </button>
                        )}
                        {can("settings") && (
                          <button
                            className="mm-btn light"
                            onClick={() => switchTab("settings")}
                          >
                            店铺设置
                          </button>
                        )}
                      </div>
                      <div className="mm-notice">
                        尚未连接实际支付和物流服务。后台的演示确认、售后审核与填写运单仅用于验证流程。
                      </div>
                    </section>
                  </div>
                  {can("orders") && (
                    <section className="mm-panel">
                      <div className="mm-panel-head">
                        <h2>最近订单</h2>
                        <button
                          className="mm-text-link"
                          onClick={() => switchTab("orders")}
                        >
                          查看全部 <ArrowUpRight size={14} />
                        </button>
                      </div>
                      <OrderTable
                        rows={overview.orders.slice(0, 5)}
                        open={setOrder}
                      />
                    </section>
                  )}
                </>
              )}
              {(["products", "orders", "audit"] as ModuleId[])
                .concat(genericTabs)
                .includes(tab) && (
                <div className="mm-admin-tools">
                  <label>
                    <Search size={16} />
                    <input
                      placeholder="搜索名称、编号、关键词…"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                    />
                  </label>
                  {!["staff", "audit", "customers", "content"].includes(
                    tab,
                  ) && (
                    <select
                      aria-label="筛选状态"
                      value={status}
                      onChange={(event) => setStatus(event.target.value)}
                    >
                      <option value="all">全部状态</option>
                      {[
                        ...new Set(
                          rows
                            .map((row) => textValue(row.status))
                            .filter(Boolean),
                        ),
                      ].map((value) => (
                        <option key={value} value={value}>
                          {statusLabels[value] || value}
                        </option>
                      ))}
                    </select>
                  )}
                  <span className="mm-tool-spacer" />
                  {[
                    "products",
                    "categories",
                    "coupons",
                    "shipping",
                    "staff",
                  ].includes(tab) && (
                    <button
                      className="mm-btn"
                      onClick={tab === "products" ? newProduct : newRecord}
                    >
                      <Plus size={15} />
                      新增{title.replace("管理", "").replace("权限", "")}
                    </button>
                  )}
                  <button
                    className="mm-btn light"
                    onClick={() => csv(filtered, title)}
                    disabled={!filtered.length}
                  >
                    <Download size={15} />
                    导出 CSV
                  </button>
                </div>
              )}
              {tab === "products" && (
                <section className="mm-panel mm-table-wrap">
                  <table className="mm-table">
                    <thead>
                      <tr>
                        <th>商品 / 规格</th>
                        <th>分类</th>
                        <th>售价</th>
                        <th>可用库存</th>
                        <th>状态</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredProducts.map((item) => (
                        <tr key={item.id}>
                          <td>
                            <div className="mm-table-product">
                              {item.images[0] && (
                                <img src={item.images[0]} alt="" />
                              )}
                              <div>
                                <strong>{item.name}</strong>
                                <small>
                                  {item.variants
                                    .map(
                                      (variant) =>
                                        variant.label || "待填写规格",
                                    )
                                    .join(" / ")}
                                </small>
                              </div>
                            </div>
                          </td>
                          <td>
                            {textValue(
                              categories.find(
                                (category) => category.id === item.category,
                              )?.name,
                            ) || "未分类"}
                          </td>
                          <td>
                            {item.variants.length
                              ? money(
                                  Math.min(
                                    ...item.variants.map(
                                      (variant) => variant.price,
                                    ),
                                  ),
                                )
                              : "待填写"}
                          </td>
                          <td>
                            {item.variants.reduce(
                              (sum, variant) => sum + variant.stock,
                              0,
                            )}
                          </td>
                          <td>
                            <span className={"mm-badge " + item.status}>
                              {statusLabels[item.status]}
                            </span>
                          </td>
                          <td>
                            <button
                              className="mm-text-link"
                              onClick={() => setProduct(structuredClone(item))}
                            >
                              编辑商品 <ArrowUpRight size={13} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!filteredProducts.length && <Empty />}
                </section>
              )}
              {tab === "orders" && (
                <section className="mm-panel">
                  <OrderTable rows={filteredOrders} open={setOrder} />
                </section>
              )}
              {tab === "inventory" && (
                <>
                  <section className="mm-panel mm-table-wrap">
                    <div className="mm-panel-head">
                      <h2>SKU 库存</h2>
                      <span>订单提交时预占，取消或到期后归还</span>
                    </div>
                    <p className="mm-muted">
                      {lowStock === 0
                        ? "低库存提醒已关闭。"
                        : `低库存提醒阈值：${lowStock}，可在店铺设置中调整。`}
                    </p>
                    <table className="mm-table">
                      <thead>
                        <tr>
                          <th>商品</th>
                          <th>规格 / SKU</th>
                          <th>当前库存</th>
                          <th>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {inventory.products.flatMap((item) =>
                          item.variants.map((variant) => (
                            <tr key={variant.id}>
                              <td>{item.name}</td>
                              <td>
                                {variant.label || "待填写规格"}
                                <small className="mm-block">{variant.id}</small>
                              </td>
                              <td>
                                <strong
                                  className={
                                    variant.active !== 0 &&
                                    variant.stock < lowStock
                                      ? "mm-low"
                                      : ""
                                  }
                                >
                                  {variant.stock}
                                </strong>
                              </td>
                              <td>
                                <button
                                  className="mm-text-link"
                                  onClick={() =>
                                    setStock({
                                      ...variant,
                                      name: item.name,
                                      userId: boot?.admin.userId || "",
                                    })
                                  }
                                >
                                  调整库存
                                </button>
                              </td>
                            </tr>
                          )),
                        )}
                      </tbody>
                    </table>
                    {!inventory.products.length && <Empty />}
                  </section>
                  <section className="mm-panel">
                    <div className="mm-panel-head">
                      <h2>库存流水</h2>
                    </div>
                    <div className="mm-table-wrap">
                      <table className="mm-table">
                        <thead>
                          <tr>
                            <th>SKU</th>
                            <th>变化</th>
                            <th>原因</th>
                            <th>操作人</th>
                            <th>时间</th>
                          </tr>
                        </thead>
                        <tbody>
                          {inventory.events.map((item) => (
                            <tr key={item.id}>
                              <td>{item.skuId}</td>
                              <td>
                                {item.delta > 0 ? "+" : ""}
                                {item.delta}
                              </td>
                              <td>{item.reason}</td>
                              <td>{item.actor}</td>
                              <td>
                                {new Date(item.createdAt).toLocaleString()}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {!inventory.events.length && <Empty />}
                    </div>
                  </section>
                </>
              )}
              {genericTabs.includes(tab) && (
                <section className="mm-panel mm-table-wrap">
                  <table className="mm-table">
                    <thead>
                      <tr>
                        <th>
                          {tab === "aftersales"
                            ? "订单 / 售后"
                            : tab === "tickets"
                              ? "主题"
                              : tab === "reviews"
                                ? "商品 / 评价"
                                : "名称 / 标识"}
                        </th>
                        <th>详情</th>
                        <th>状态</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRecords.map((item) => (
                        <tr key={textValue(item.id || item.user_id)}>
                          <td>
                            <strong>
                              {textValue(
                                item.name ||
                                  item.title ||
                                  item.subject ||
                                  item.orderId ||
                                  item.email ||
                                  item.productId,
                              )}
                            </strong>
                            <small className="mm-block">
                              {textValue(
                                item.code ||
                                  item.email ||
                                  item.id ||
                                  item.user_id,
                              )}
                            </small>
                          </td>
                          <td className="mm-cell-detail">
                            {tab === "coupons"
                              ? `${money(Number(item.discount))} · 满 ${money(Number(item.minimum))} · ${new Date(textValue(item.expires)).toLocaleDateString()}`
                              : tab === "shipping"
                                ? `${money(Number(item.fee))} · 免运费门槛 ${money(Number(item.freeAbove))}`
                                : tab === "staff"
                                  ? roleNames[textValue(item.role)]
                                  : textValue(
                                      item.reason ||
                                        item.text ||
                                        item.message ||
                                        item.description ||
                                        item.tags ||
                                        item.nameMS ||
                                        item.nameEN,
                                    ) || "—"}
                            {item.reply && (
                              <small className="mm-block">
                                商家回复：{textValue(item.reply)}
                              </small>
                            )}
                          </td>
                          <td>
                            <span className="mm-badge">
                              {tab === "staff"
                                ? Number(item.active)
                                  ? "已启用"
                                  : "已停用"
                                : tab === "content"
                                  ? item.enabled
                                    ? "显示中"
                                    : "已停用"
                                  : statusLabels[textValue(item.status)] ||
                                    textValue(item.status) ||
                                    "—"}
                            </span>
                          </td>
                          <td>
                            <button
                              className="mm-text-link"
                              disabled={
                                tab === "staff" && item.role === "owner"
                              }
                              onClick={() =>
                                setEditing(
                                  tab === "staff"
                                    ? { ...item, userId: item.user_id }
                                    : item,
                                )
                              }
                            >
                              {["aftersales", "reviews", "tickets"].includes(
                                tab,
                              )
                                ? "审核 / 回复"
                                : "编辑"}
                            </button>
                            {["categories", "coupons", "shipping"].includes(
                              tab,
                            ) && (
                              <button
                                className="mm-icon"
                                aria-label="删除"
                                onClick={() =>
                                  setEditing({ ...item, _delete: true })
                                }
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!filteredRecords.length && <Empty />}
                </section>
              )}
              {tab === "reports" && (
                <>
                  <div className="mm-stats">
                    <div className="mm-stat">
                      <span>体验订单总额</span>
                      <strong>{money(report.total)}</strong>
                      <small>包含未取消的体验订单</small>
                    </div>
                    <div className="mm-stat">
                      <span>订单笔数</span>
                      <strong>{report.count}</strong>
                      <small>包含全部订单状态</small>
                    </div>
                    <div className="mm-stat">
                      <span>真实收款</span>
                      <strong>{money(report.realRevenue)}</strong>
                      <small>支付通道尚未连接</small>
                    </div>
                    <div className="mm-stat">
                      <span>报表导出</span>
                      <button
                        className="mm-btn light"
                        disabled={!report.orders.length}
                        onClick={() =>
                          csv(report.orders, storeName + "_orders")
                        }
                      >
                        <Download size={16} />
                        下载 CSV
                      </button>
                    </div>
                  </div>
                  <section className="mm-panel">
                    <div className="mm-panel-head">
                      <h2>订单明细</h2>
                    </div>
                    <OrderTable rows={report.orders} open={setOrder} />
                  </section>
                </>
              )}
              {tab === "audit" && (
                <section className="mm-panel mm-table-wrap">
                  <table className="mm-table">
                    <thead>
                      <tr>
                        <th>时间</th>
                        <th>操作人 ID</th>
                        <th>动作</th>
                        <th>目标</th>
                        <th>详情</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRecords.map((item) => (
                        <tr key={textValue(item.id)}>
                          <td>
                            {new Date(
                              textValue(item.created_at),
                            ).toLocaleString()}
                          </td>
                          <td className="mm-id-cell">
                            {textValue(item.actor)}
                          </td>
                          <td>{textValue(item.action)}</td>
                          <td>{textValue(item.target)}</td>
                          <td className="mm-cell-detail">
                            {textValue(item.detail)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!filteredRecords.length && <Empty />}
                </section>
              )}
              {tab === "settings" && (
                <>
                  <section className="mm-panel">
                    <div className="mm-panel-head">
                      <h2>店铺基础信息</h2>
                      <button
                        className="mm-btn light"
                        onClick={() =>
                          setEditing(
                            records[0] || {
                              id: "store",
                              name: "Mori Matcha",
                              currency: "MYR",
                              contact: "",
                              lowStock: 10,
                              announcement: "",
                              returnsPolicy: "",
                              privacyPolicy: "",
                            },
                          )
                        }
                      >
                        编辑设置
                      </button>
                    </div>
                    {records[0] && (
                      <dl className="mm-settings-list">
                        {fieldConfig.settings?.map(([key, label]) => (
                          <div key={key}>
                            <dt>{label}</dt>
                            <dd>
                              {records[0][key] === 0
                                ? "0"
                                : textValue(records[0][key]) || "未填写"}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    )}
                    <p className="mm-muted">
                      购买与咨询链接留空时，商城不会显示对应入口。填写平台提供的
                      HTTPS 链接。
                    </p>
                  </section>
                  <section className="mm-panel">
                    <div className="mm-panel-head">
                      <h2>外部服务</h2>
                      <span>待接入</span>
                    </div>
                    <div className="mm-integrations">
                      {[
                        "在线支付 / 退款",
                        "物流下单 / 轨迹",
                        "邮件 / 短信",
                        "发票 / 对账",
                      ].map((service) => (
                        <div key={service}>
                          <span>{service}</span>
                          <span className="mm-badge">尚未连接</span>
                        </div>
                      ))}
                    </div>
                    <p className="mm-muted">
                      体验订单不会产生真实款项，公开购买入口可在上方配置。
                    </p>
                  </section>
                </>
              )}
            </>
          )}
          <p className="mm-admin-foot">
            {storeName} Seller Centre · 每一份绿意，都值得认真对待。
          </p>
        </main>
      </div>
      {product && (
        <ProductEditor
          product={product}
          categories={categories}
          busy={busy}
          error={error}
          onClose={() => setProduct(null)}
          onChange={setProduct}
          onSave={() =>
            void run(async () => {
              await api(
                "/admin/products",
                product.id ? "PATCH" : "POST",
                product,
              );
              setProduct(null);
              await load(tab);
            })
          }
        />
      )}
      {editing && (
        <Modal
          title={
            editing._delete
              ? "删除确认"
              : title + " · " + (editing.id || editing.userId ? "编辑" : "新增")
          }
          onClose={() => setEditing(null)}
        >
          {editing._delete ? (
            <>
              <p>确定删除「{textValue(editing.name)}」？</p>
              <button
                className="mm-btn danger"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await api(endpoint(tab) + "/" + editing.id, "DELETE");
                    setEditing(null);
                    await load(tab);
                  })
                }
              >
                确认删除
              </button>
              {error && <p className="mm-error">{error}</p>}
            </>
          ) : (
            <>
              {["aftersales", "reviews", "tickets"].includes(tab) && (
                <div className="mm-record-summary">
                  <p>
                    <strong>
                      {textValue(
                        editing.orderId || editing.subject || editing.productId,
                      )}
                    </strong>
                  </p>
                  <p>
                    {textValue(
                      editing.reason || editing.text || editing.message,
                    )}
                  </p>
                  <p>{textValue(editing.description)}</p>
                  {tab === "aftersales" && (
                    <div className="mm-notice">
                      申请金额：{money(Number(editing.amount))}
                      。这里只审核申请，不会触发实际退款。
                    </div>
                  )}
                </div>
              )}
              <RecordEditor
                tab={tab}
                record={editing}
                busy={busy}
                error={error}
                onSave={(next) => void run(() => saveRecord(next))}
              />
            </>
          )}
        </Modal>
      )}
      {order && (
        <OrderDetails
          order={order}
          canEdit={can("orders")}
          role={boot?.admin.role || ""}
          busy={busy}
          error={error}
          onClose={() => setOrder(null)}
          onSave={(values) =>
            void run(async () => {
              await api("/admin/orders/" + order.id, "PATCH", values);
              setOrder(null);
              await load(tab);
            })
          }
        />
      )}
    </div>
  );
}

function ProductEditor({
  product,
  categories,
  busy,
  error,
  onChange,
  onClose,
  onSave,
}: {
  product: ProductDraft;
  categories: AdminRecord[];
  busy: boolean;
  error: string;
  onChange: (product: ProductDraft) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const [uploads, setUploads] = useState(0);
  const uploadStateChanged = (uploading: boolean) =>
    setUploads((count) => count + (uploading ? 1 : -1));
  const updateVariant = (index: number, patch: Partial<Variant>) =>
    onChange({
      ...product,
      variants: product.variants.map((variant, position) =>
        position === index ? { ...variant, ...patch } : variant,
      ),
    });
  const selectedCategory = categories.find(
    (category) => category.id === product.category,
  );
  const textFields = [
    ["name", "中文商品名称"],
    ["nameEN", "英文名称"],
    ["nameMS", "马来文名称"],
    ["origin", "茶叶产地"],
    ["ingredients", "配料信息"],
  ] as const;
  const descriptionFields = [
    ["description", "中文商品介绍"],
    ["descriptionEN", "英文商品介绍"],
    ["descriptionMS", "马来文商品介绍"],
    ["storage", "储存方式"],
  ] as const;
  return (
    <Modal title={product.id ? "编辑商品" : "新增商品"} onClose={onClose} wide>
      <form
        className="mm-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!uploads) onSave();
        }}
      >
        {textFields.map(([key, label]) => (
          <label key={key}>
            {label}
            <input
              required={key === "name"}
              value={product[key] || ""}
              maxLength={key === "name" ? 160 : 3000}
              onChange={(event) =>
                onChange({ ...product, [key]: event.target.value })
              }
            />
          </label>
        ))}
        <label>
          商品分类
          <select
            required={product.status === "active"}
            value={product.category}
            onChange={(event) =>
              onChange({ ...product, category: event.target.value })
            }
          >
            <option value="">选择分类</option>
            {product.category && !selectedCategory && (
              <option value={product.category}>
                原分类已不存在，请重新选择
              </option>
            )}
            {categories.map((category) => (
              <option
                key={textValue(category.id)}
                value={textValue(category.id)}
                disabled={category.status !== "active"}
              >
                {textValue(category.name)}
                {category.status !== "active" ? "（已停用）" : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          上架状态
          <select
            value={product.status}
            onChange={(event) =>
              onChange({ ...product, status: event.target.value })
            }
          >
            <option value="draft">草稿</option>
            <option value="active">上架</option>
            <option value="archived">下架</option>
          </select>
        </label>
        {descriptionFields.map(([key, label]) => (
          <label className="full" key={key}>
            {label}
            <textarea
              value={product[key] || ""}
              maxLength={5000}
              onChange={(event) =>
                onChange({ ...product, [key]: event.target.value })
              }
            />
          </label>
        ))}
        <div className="full">
          <h3>商品主图与轮播图</h3>
          <ImageEditor
            images={product.images}
            onBusyChange={uploadStateChanged}
            change={(images) => onChange({ ...product, images })}
          />
        </div>
        <div className="full">
          <h3>商品详情介绍图</h3>
          <ImageEditor
            images={product.detailImages}
            onBusyChange={uploadStateChanged}
            change={(detailImages) => onChange({ ...product, detailImages })}
          />
        </div>
        <div className="full mm-between">
          <h3>商品规格 / SKU</h3>
          <button
            type="button"
            className="mm-btn light"
            onClick={() =>
              onChange({
                ...product,
                variants: [
                  ...product.variants,
                  {
                    id: crypto.randomUUID(),
                    label: "",
                    price: 0,
                    stock: 0,
                    active: 0,
                    image: "",
                  },
                ],
              })
            }
          >
            <Plus size={15} />
            添加规格
          </button>
        </div>
        <div className="full mm-sku-edit">
          {product.variants.map((variant, index) => (
            <div key={variant.id}>
              <label>
                规格名称
                <input
                  required={variant.active !== 0}
                  value={variant.label}
                  maxLength={160}
                  placeholder="请按实际商品填写"
                  onChange={(event) =>
                    updateVariant(index, { label: event.target.value })
                  }
                />
              </label>
              <label>
                售价 (RM)
                <input
                  type="number"
                  step="0.01"
                  min={variant.active !== 0 ? "0.01" : "0"}
                  required
                  value={variant.price / 100}
                  onChange={(event) =>
                    updateVariant(index, {
                      price: Math.round(Number(event.target.value) * 100),
                    })
                  }
                />
              </label>
              <label>
                {product.id ? "当前库存，调整请到库存管理" : "初始库存"}
                <input
                  type="number"
                  min="0"
                  step="1"
                  required
                  readOnly={!!product.id}
                  value={variant.stock}
                  onChange={(event) =>
                    updateVariant(index, { stock: Number(event.target.value) })
                  }
                />
              </label>
              <label>
                规格状态
                <select
                  value={variant.active ?? 1}
                  onChange={(event) =>
                    updateVariant(index, { active: Number(event.target.value) })
                  }
                >
                  <option value="1">启用</option>
                  <option value="0">停用 / 待补资料</option>
                </select>
              </label>
              <small>SKU: {variant.id}</small>
              <div style={{ gridColumn: "1 / -1" }}>
                <h4>此规格专属图片</h4>
                <ImageEditor
                  images={variant.image ? [variant.image] : []}
                  single
                  onBusyChange={uploadStateChanged}
                  change={(images) =>
                    updateVariant(index, { image: images[0] || "" })
                  }
                />
                <small>图片按 SKU ID 独立绑定。留空时使用商品首图。</small>
              </div>
            </div>
          ))}
        </div>
        <p className="mm-notice full">
          新商品默认草稿，新规格默认停用。请确认规格、价格与图片后再启用；已有
          SKU 的库存通过库存管理调整，避免覆盖订单占用的库存。
        </p>
        {error && (
          <p className="mm-error full" role="alert">
            {error}
          </p>
        )}
        <button className="mm-btn full" disabled={busy || uploads > 0}>
          {uploads > 0 ? "图片上传中…" : busy ? "保存中…" : "保存商品"}
        </button>
      </form>
    </Modal>
  );
}

function RecordEditor({
  tab,
  record,
  busy,
  error,
  onSave,
}: {
  tab: ModuleId;
  record: AdminRecord;
  busy: boolean;
  error: string;
  onSave: (record: AdminRecord) => void;
}) {
  const [image, setImage] = useState(textValue(record.image));
  const [validationError, setValidationError] = useState("");
  const [uploading, setUploading] = useState(false);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (uploading) return;
    setValidationError("");
    const form = new FormData(event.currentTarget);
    const next: AdminRecord = {};
    for (const [key, , type] of fieldConfig[tab] || []) {
      let value: RecordValue = String(form.get(key) ?? "").trim();
      if (type === "money") value = Math.round(Number(value) * 100);
      else if (type === "number" || key === "active") value = Number(value);
      else if (type === "checkbox") value = form.get(key) === "on";
      else if (type === "datetime") {
        const date = new Date(String(value));
        if (Number.isNaN(date.getTime())) {
          setValidationError("请填写有效的到期时间");
          return;
        }
        value = date.toISOString();
      } else if (type === "url" && value) {
        try {
          if (new URL(String(value)).protocol !== "https:") throw new Error();
        } catch {
          setValidationError("购买与咨询链接必须使用 HTTPS");
          return;
        }
      }
      next[key] = value;
    }
    onSave(next);
  }
  return (
    <form className="mm-form" onSubmit={submit}>
      {fieldConfig[tab]?.map(([key, label, type, options]) => {
        let value = textValue(record[key]);
        if (type === "money") value = String(Number(value) / 100);
        if (type === "datetime" && value) {
          const date = new Date(value);
          value = Number.isNaN(date.getTime())
            ? ""
            : new Date(date.getTime() - date.getTimezoneOffset() * 60000)
                .toISOString()
                .slice(0, 16);
        }
        if (type === "image")
          return (
            <div key={key} className="full">
              <span>{label}</span>
              <ImageEditor
                images={image ? [image] : []}
                single
                onBusyChange={setUploading}
                change={(images) => setImage(images[0] || "")}
              />
              <input name={key} type="hidden" value={image} />
            </div>
          );
        return (
          <label key={key} className={type === "textarea" ? "full" : ""}>
            {label}
            {type === "select" ? (
              <select name={key} defaultValue={value}>
                {options?.split(",").map((option) => (
                  <option key={option} value={option}>
                    {statusLabels[option] ||
                      roleNames[option] ||
                      (option === "1"
                        ? "已启用"
                        : option === "0"
                          ? "已停用"
                          : option)}
                  </option>
                ))}
              </select>
            ) : type === "textarea" ? (
              <textarea name={key} defaultValue={value} maxLength={5000} />
            ) : type === "checkbox" ? (
              <input
                name={key}
                type="checkbox"
                defaultChecked={!!record[key]}
              />
            ) : (
              <input
                name={key}
                type={
                  type === "money" || type === "number"
                    ? "number"
                    : type === "datetime"
                      ? "datetime-local"
                      : type === "url"
                        ? "url"
                        : key === "email"
                          ? "email"
                          : "text"
                }
                min={type === "money" || type === "number" ? 0 : undefined}
                step={
                  type === "money"
                    ? "0.01"
                    : type === "number"
                      ? "1"
                      : undefined
                }
                defaultValue={value}
                readOnly={
                  (tab === "customers" && ["userId", "email"].includes(key)) ||
                  (tab === "settings" && key === "currency")
                }
                required={!optionalFields.has(key)}
                maxLength={type === "url" ? 2048 : 160}
              />
            )}
          </label>
        );
      })}
      {tab === "staff" && (
        <div className="mm-notice full">
          员工需先在管理员登录页获取自己的账号
          ID。账号授权后，还需获得本站访问权限才能访问当前私有预览。
        </div>
      )}
      {(validationError || error) && (
        <p className="mm-error full" role="alert">
          {validationError || error}
        </p>
      )}
      <button className="mm-btn full" disabled={busy || uploading}>
        {uploading ? "图片上传中…" : busy ? "保存中…" : "保存"}
      </button>
    </form>
  );
}

function ImageEditor({
  images,
  change,
  single = false,
  onBusyChange,
}: {
  images: string[];
  change: (images: string[]) => void;
  single?: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [url, setUrl] = useState("");
  const current = useRef({ images, change });
  useEffect(() => {
    current.current = { images, change };
  }, [images, change]);
  function add(added: string[]) {
    current.current.change(
      single ? added.slice(-1) : [...current.current.images, ...added],
    );
  }
  return (
    <div className="mm-image-editor">
      <div className="mm-image-list">
        {images.map((source, index) => (
          <div key={source + index}>
            <img src={source} alt={"商品图 " + (index + 1)} />
            <span>
              {single ? "当前图片" : index === 0 ? "首图" : index + 1}
            </span>
            <button
              type="button"
              disabled={busy}
              aria-label="移除图片"
              onClick={() =>
                change(images.filter((_, position) => position !== index))
              }
            >
              <X size={13} />
            </button>
            {index > 0 && !single && (
              <button
                type="button"
                disabled={busy}
                className="mm-set-first"
                onClick={() =>
                  change([
                    source,
                    ...images.filter((_, position) => position !== index),
                  ])
                }
              >
                设为首图
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="mm-inline">
        <label className="mm-btn light mm-upload">
          <ImagePlus size={15} />
          {busy ? "上传中…" : single && images.length ? "替换图片" : "上传图片"}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple={!single}
            disabled={busy}
            onChange={async (event) => {
              const input = event.currentTarget;
              const files = Array.from(input.files || []);
              if (!files.length) return;
              setBusy(true);
              onBusyChange?.(true);
              setError("");
              const added: string[] = [];
              try {
                for (const file of files) {
                  if (file.size > 5 * 1024 * 1024)
                    throw new Error("每张图片不能超过 5MB");
                  const form = new FormData();
                  form.append("file", file);
                  const result = await api<{ url: string }>(
                    "/admin/uploads",
                    "POST",
                    form,
                  );
                  added.push(result.url);
                }
              } catch (reason) {
                setError(errorMessage(reason));
              } finally {
                if (added.length) add(added);
                setBusy(false);
                onBusyChange?.(false);
                input.value = "";
              }
            }}
          />
        </label>
        <input
          disabled={busy}
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="或填写 HTTPS 图片地址"
          aria-label="图片地址"
        />
        <button
          className="mm-btn light"
          type="button"
          disabled={!url.trim() || busy}
          onClick={() => {
            const value = url.trim();
            let valid =
              value.startsWith("/assets/") ||
              value.startsWith("/api/v1/media/");
            try {
              valid ||= new URL(value).protocol === "https:";
            } catch {
              /* Local media paths are valid without an origin. */
            }
            if (!valid) {
              setError("请填写 HTTPS 图片地址或站内图片路径");
              return;
            }
            add([value]);
            setUrl("");
            setError("");
          }}
        >
          {single && images.length ? "替换" : "添加"}
        </button>
      </div>
      <small>
        PNG / JPG / WebP / GIF，每张不超过 5MB。
        {single ? "上传或添加会替换当前图片。" : "可将任意图片设为首图。"}
      </small>
      {error && (
        <p className="mm-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function OrderDetails({
  order,
  canEdit,
  role,
  busy,
  error,
  onClose,
  onSave,
}: {
  order: Order;
  canEdit: boolean;
  role: string;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSave: (values: Record<string, FormDataEntryValue>) => void;
}) {
  return (
    <Modal title={"订单详情 · " + order.id} onClose={onClose} wide>
      <div className="mm-between">
        <span className={"mm-badge " + order.status}>
          {statusLabels[order.status]}
        </span>
        <strong>{money(order.total)}</strong>
      </div>
      <div className="mm-notice">
        体验订单 · {statusLabels[order.paymentStatus]} · 未产生真实收款或发货
        {order.status === "pending_payment" && order.expiresAt && (
          <p>预占到期：{new Date(order.expiresAt).toLocaleString()}</p>
        )}
        {order.cancellationReason && (
          <p>取消原因：{order.cancellationReason}</p>
        )}
      </div>
      <div className="mm-detail">
        <div>
          <h3>收货信息</h3>
          <p>
            {order.customer.name} · {order.customer.phone}
          </p>
          <p>{order.customer.email}</p>
          <p>
            {order.customer.address}, {order.customer.city},{" "}
            {order.customer.state}, {order.customer.postcode}
          </p>
          <p>顾客备注：{order.customer.note || "—"}</p>
        </div>
        <div>
          <h3>金额明细</h3>
          <div className="mm-bill">
            <span>
              商品小计<b>{money(order.subtotal)}</b>
            </span>
            <span>
              优惠 {order.coupon}
              <b>− {money(order.discount)}</b>
            </span>
            <span>
              运费<b>{money(order.shippingFee)}</b>
            </span>
            <strong>
              合计<b>{money(order.total)}</b>
            </strong>
          </div>
        </div>
      </div>
      {order.items.map((item) => (
        <div className="mm-cart-row" key={item.skuId}>
          {item.image && <img src={item.image} alt="" />}
          <div>
            <strong>{item.name}</strong>
            <small>
              {item.label} × {item.quantity}
            </small>
          </div>
          <strong>{money(item.quantity * item.price)}</strong>
        </div>
      ))}
      {canEdit && (
        <form
          className="mm-form"
          onSubmit={(event) => {
            event.preventDefault();
            onSave(Object.fromEntries(new FormData(event.currentTarget)));
          }}
        >
          <label className="full">
            处理操作
            <select name="action" required>
              <option value="note">仅更新内部备注</option>
              {role !== "finance" && (
                <>
                  {order.status === "pending_payment" && (
                    <option value="confirm_demo">
                      演示确认，转为待发货（非真实收款）
                    </option>
                  )}
                  {order.status === "processing" && (
                    <option value="ship">填写运单，转为已发货（仅测试）</option>
                  )}
                  {order.status === "shipped" && (
                    <option value="complete">标记完成（仅测试）</option>
                  )}
                  {["pending_payment", "processing"].includes(order.status) && (
                    <option value="cancel">取消订单并归还库存</option>
                  )}
                </>
              )}
            </select>
          </label>
          <label>
            承运商
            <input
              name="carrier"
              defaultValue={order.carrier}
              maxLength={160}
            />
          </label>
          <label>
            运单号
            <input
              name="tracking"
              defaultValue={order.tracking}
              maxLength={160}
            />
          </label>
          <label className="full">
            内部备注
            <textarea name="note" defaultValue={order.note} maxLength={3000} />
          </label>
          {error && (
            <p className="mm-error full" role="alert">
              {error}
            </p>
          )}
          <button className="mm-btn full" disabled={busy}>
            保存处理
          </button>
        </form>
      )}
    </Modal>
  );
}

function Empty() {
  return (
    <div className="mm-empty">
      <Package size={30} />
      <p>暂无记录，新增或产生业务数据后会显示在这里。</p>
    </div>
  );
}

function OrderTable({
  rows,
  open,
}: {
  rows: Order[];
  open: (order: Order) => void;
}) {
  return (
    <div className="mm-table-wrap">
      <table className="mm-table">
        <thead>
          <tr>
            <th>订单编号</th>
            <th>收货人</th>
            <th>金额</th>
            <th>状态</th>
            <th>时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((order) => (
            <tr key={order.id}>
              <td>
                <strong>{order.id}</strong>
                <small className="mm-block">
                  体验订单 · {statusLabels[order.paymentStatus]}
                </small>
              </td>
              <td>{order.customer?.name}</td>
              <td>{money(order.total)}</td>
              <td>
                <span className={"mm-badge " + order.status}>
                  {statusLabels[order.status]}
                </span>
              </td>
              <td>{new Date(order.createdAt).toLocaleDateString()}</td>
              <td>
                <button className="mm-text-link" onClick={() => open(order)}>
                  查看详情
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <Empty />}
    </div>
  );
}
