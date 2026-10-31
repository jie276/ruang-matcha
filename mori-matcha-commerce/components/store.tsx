"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ArrowUpRight,
  Leaf,
  ShoppingBag,
  Heart,
  Search,
  Minus,
  Plus,
  Trash2,
  Package,
  Check,
} from "lucide-react";
import { api } from "@/lib/api";
import { defaultHero, money, type Product } from "@/lib/model";
import Modal from "./modal";
import TeaMotion from "./tea-motion";
import { getCopy, isLanguage, orderStatus, type Language } from "./store-copy";
import {
  localized,
  platformUrl,
  publicProducts,
  restoredCheckoutKey,
  storedCart,
  variantImage,
  type Catalog,
  type Session,
  type CartEntry,
  type CartItem,
  type Order,
  type Aftersale,
  type Address,
  type Ticket,
} from "./store-data";

const initialCatalog: Catalog = {
  products: [],
  categories: [],
  hero: defaultHero,
  shipping: [],
  ready: false,
  reviews: [],
};
const locale = { zh: "zh-CN", en: "en-MY", ms: "ms-MY" };

export default function Store() {
  const [lang, setLang] = useState<Language>("zh");
  const [catalog, setCatalog] = useState<Catalog>(initialCatalog);
  const [catalogLoaded, setCatalogLoaded] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [favorites, setFavorites] = useState<string[]>([]);
  const [savedOnly, setSavedOnly] = useState(false);
  const [cart, setCart] = useState<CartEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [modal, setModal] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [galleryImage, setGalleryImage] = useState("");
  const [orders, setOrders] = useState<Order[]>([]);
  const [aftersales, setAftersales] = useState<Aftersale[]>([]);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [shippingId, setShippingId] = useState("");
  const [coupon, setCoupon] = useState("");
  const [discount, setDiscount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [activeOrder, setActiveOrder] = useState<Order | null>(null);
  const [success, setSuccess] = useState<Order | null>(null);
  const [hasPendingOrder, setHasPendingOrder] = useState(false);
  const idempotencyKey = useRef("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const t = getCopy(lang);
  const products = publicProducts(catalog.products, catalog.categories);
  const categories = catalog.categories.filter(
    (category) => category.status === "active",
  );
  const storeName = catalog.settings?.name?.trim() || "Mori Matcha";
  const hero = catalog.hero || defaultHero;
  const selected = products.find((product) => product.id === selectedId);
  const selectedVariant = selected?.variants.find(
    (variant) => variant.id === variantId,
  );
  const detailImage = selected
    ? galleryImage || variantImage(selected, selectedVariant)
    : "";
  const productName = (product: Product) =>
    localized(lang, product.name, product.nameEN, product.nameMS);
  const description = (product: Product) =>
    localized(
      lang,
      product.description,
      product.descriptionEN,
      product.descriptionMS,
    );
  const categoryName = (id: string) => {
    const category = categories.find((item) => item.id === id);
    return category
      ? localized(lang, category.name, category.nameEN, category.nameMS)
      : t.categoryFallback;
  };
  const cartItems: CartItem[] = cart.flatMap((item) => {
    const product = products.find((product) =>
      product.variants.some((variant) => variant.id === item.skuId),
    );
    const variant = product?.variants.find(
      (variant) => variant.id === item.skuId,
    );
    return product && variant ? [{ ...item, product, variant }] : [];
  });
  const unavailableItems = catalogLoaded
    ? cart.filter(
        (item) => !cartItems.some((valid) => valid.skuId === item.skuId),
      )
    : [];
  const stockExceeded = cartItems.some(
    (item) => item.quantity > item.variant.stock,
  );
  const subtotal = cartItems.reduce(
    (sum, item) => sum + item.variant.price * item.quantity,
    0,
  );
  const shipping = catalog.shipping.find((item) => item.id === shippingId);
  const shippingFee = shipping
    ? shipping.freeAbove > 0 && subtotal - discount >= shipping.freeAbove
      ? 0
      : shipping.fee
    : 0;
  const total = Math.max(0, subtotal - discount) + shippingFee;
  const canCheckout =
    catalog.ready &&
    cartItems.length > 0 &&
    !unavailableItems.length &&
    !stockExceeded &&
    !!shipping;
  const effectiveFilter = categories.some((category) => category.id === filter)
    ? filter
    : "all";
  const visible = products.filter(
    (product) =>
      (effectiveFilter === "all" || product.category === effectiveFilter) &&
      (!savedOnly || favorites.includes(product.id)) &&
      `${productName(product)} ${description(product)}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const whatsappUrl = platformUrl(catalog.settings?.whatsappUrl);
  const platforms = [
    { name: "Shopee", url: platformUrl(catalog.settings?.shopeeUrl) },
    { name: "TikTok Shop", url: platformUrl(catalog.settings?.tiktokUrl) },
  ];

  const notify = useCallback((message: string) => {
    setToast(message);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(""), 4500);
  }, []);
  const reportError = (cause: unknown) =>
    notify(
      lang === "zh" && cause instanceof Error ? cause.message : t.requestFailed,
    );
  const reload = useCallback(async () => {
    const next = await api<Catalog>("/catalog");
    setCatalog(next);
    setCatalogLoaded(true);
    setShippingId((current) =>
      next.shipping.some((item) => item.id === current)
        ? current
        : next.shipping[0]?.id || "",
    );
    setDiscount(0);
    setError("");
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.resolve()
      .then(reload)
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : "Error");
      });
    void api<Session>("/session")
      .then((value) => {
        if (active) setSession(value);
      })
      .catch(() => {});
    // Local storage is read after hydration so the first server and client render agree.
    void Promise.resolve().then(() => {
      if (!active) return;
      try {
        const savedCart = storedCart(
          JSON.parse(localStorage.getItem("mori.cart.v2") || "[]"),
        );
        setCart(savedCart);
        try {
          idempotencyKey.current = restoredCheckoutKey(
            JSON.parse(sessionStorage.getItem("mori.checkout.v1") || "null"),
            savedCart,
          );
          setHasPendingOrder(!!idempotencyKey.current);
        } catch {
          /* A blocked session store does not prevent this visit's retries. */
        }
        const saved: unknown = JSON.parse(
          localStorage.getItem("mori.saved.v2") || "[]",
        );
        if (Array.isArray(saved))
          setFavorites(
            saved.filter((item): item is string => typeof item === "string"),
          );
        const language = localStorage.getItem("mori.lang");
        if (isLanguage(language)) setLang(language);
      } catch {
        /* A browser can disable storage; shopping still works for this visit. */
      }
      setLoaded(true);
    });
    return () => {
      active = false;
      clearTimeout(timer.current);
    };
  }, [reload]);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem("mori.cart.v2", JSON.stringify(cart));
      localStorage.setItem("mori.saved.v2", JSON.stringify(favorites));
      localStorage.setItem("mori.lang", lang);
    } catch {
      /* Storage is optional. */
    }
  }, [cart, favorites, lang, loaded]);

  useEffect(() => {
    document.documentElement.lang = locale[lang];
    document.title = `${storeName} · ${t.shop}`;
  }, [lang, storeName, t.shop]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) =>
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        }),
      { threshold: 0.08 },
    );
    document
      .querySelectorAll(".mm-reveal")
      .forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [catalog, effectiveFilter, query, savedOnly]);

  const updateCart = (
    next: CartEntry[] | ((current: CartEntry[]) => CartEntry[]),
  ) => {
    setCart(next);
    setDiscount(0);
    idempotencyKey.current = "";
    setHasPendingOrder(false);
    try {
      sessionStorage.removeItem("mori.checkout.v1");
    } catch {
      /* Storage is optional. */
    }
  };
  const ensureOrderKey = () => {
    if (!idempotencyKey.current) idempotencyKey.current = crypto.randomUUID();
    setHasPendingOrder(true);
    try {
      sessionStorage.setItem(
        "mori.checkout.v1",
        JSON.stringify({
          key: idempotencyKey.current,
          cart: JSON.stringify(cart),
        }),
      );
    } catch {
      /* Keep the in-memory key when storage is blocked. */
    }
    return idempotencyKey.current;
  };
  const changeQuantity = (skuId: string, amount: number) => {
    const stock =
      cartItems.find((item) => item.skuId === skuId)?.variant.stock || 0;
    updateCart((current) =>
      current
        .map((item) =>
          item.skuId === skuId
            ? {
                ...item,
                quantity:
                  amount > 0
                    ? Math.min(100, stock, item.quantity + amount)
                    : item.quantity + amount,
              }
            : item,
        )
        .filter((item) => item.quantity > 0),
    );
  };
  const add = (product: Product, skuId: string) => {
    const variant = product.variants.find((item) => item.id === skuId);
    const quantity = cart.find((item) => item.skuId === skuId)?.quantity || 0;
    if (!variant || variant.stock <= quantity || quantity >= 100) {
      notify(t.out);
      return;
    }
    updateCart((current) =>
      quantity
        ? current.map((item) =>
            item.skuId === skuId
              ? { ...item, quantity: item.quantity + 1 }
              : item,
          )
        : [...current, { skuId, quantity: 1 }],
    );
    notify(t.added);
  };
  const openProduct = (product: Product) => {
    setSelectedId(product.id);
    setVariantId(product.variants[0]?.id || "");
    setGalleryImage("");
    setModal("product");
  };
  const close = () => setModal("");
  // Hosted authentication is outside the client router and requires a full navigation.
  const signIn = () => {
    window.location.assign(
      new URL("/signin-with-chatgpt?return_to=%2F", window.location.origin),
    );
  };
  const openOrders = async () => {
    if (!session?.user) {
      signIn();
      return;
    }
    setModal("orders");
    setBusy(true);
    try {
      const [nextOrders, nextAftersales] = await Promise.all([
        api<Order[]>("/orders"),
        api<Aftersale[]>("/my/aftersales"),
      ]);
      setOrders(nextOrders);
      setAftersales(nextAftersales);
    } catch (cause) {
      reportError(cause);
    } finally {
      setBusy(false);
    }
  };
  const openContact = () => {
    setModal("contact");
    if (session?.user)
      void api<Ticket[]>("/tickets").then(setTickets).catch(reportError);
  };
  const recoverOrder = async () => {
    if (!idempotencyKey.current) return false;
    const previous = await api<Order[]>("/orders");
    const recovered = previous.find(
      (order) => order.idempotencyKey === idempotencyKey.current,
    );
    if (!recovered) return false;
    setSuccess(recovered);
    updateCart([]);
    setModal("success");
    void reload().catch(() => {});
    return true;
  };
  const checkout = async () => {
    if (!session?.user) {
      signIn();
      return;
    }
    setBusy(true);
    try {
      if (await recoverOrder()) return;
      if (!canCheckout) {
        notify(
          stockExceeded
            ? t.stockChanged
            : unavailableItems.length
              ? t.unavailable
              : t.notReady,
        );
        return;
      }
      setAddresses(await api<Address[]>("/my/addresses"));
      setModal("checkout");
    } catch (cause) {
      reportError(cause);
    } finally {
      setBusy(false);
    }
  };
  const submitOrder = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !canCheckout) return;
    const form = new FormData(event.currentTarget);
    const value = (key: string) => String(form.get(key) || "");
    const orderKey = ensureOrderKey();
    setBusy(true);
    try {
      const customer = {
        name: value("name"),
        phone: value("phone"),
        email: value("email"),
        address: value("address"),
        city: value("city"),
        state: value("state"),
        postcode: value("postcode"),
        note: value("note"),
      };
      const order = await api<Order>("/orders", "POST", {
        idempotencyKey: orderKey,
        items: cartItems.map(({ skuId, quantity }) => ({ skuId, quantity })),
        customer,
        shippingId,
        coupon: discount > 0 ? coupon : "",
        acknowledgeDemo: true,
      });
      if (form.has("saveAddress")) {
        const address = {
          name: customer.name,
          phone: customer.phone,
          address: customer.address,
          city: customer.city,
          state: customer.state,
          postcode: customer.postcode,
        };
        await api("/my/addresses", "POST", address).catch(() =>
          notify(t.addressNotSaved),
        );
      }
      setSuccess(order);
      updateCart([]);
      setModal("success");
      void reload().catch(() => {});
    } catch (cause) {
      // A lost response can follow a committed order; reconcile before another POST.
      if (await recoverOrder().catch(() => false)) return;
      reportError(cause);
      // Refresh stale availability while preserving the key for an uncertain response.
      await reload().catch(() => {});
    } finally {
      setBusy(false);
    }
  };
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } catch (cause) {
      reportError(cause);
    } finally {
      setBusy(false);
    }
  };
  const date = (value: string) =>
    new Date(value).toLocaleString(locale[lang], {
      timeZone: "Asia/Kuala_Lumpur",
    });

  return (
    <>
      <TeaMotion />
      <div className="topline">
        <span className="dot" />
        <span>{catalog.settings?.announcement || t.origin}</span>
      </div>
      <header className="site-header">
        <div className="header-inner">
          <a className="brand" href="#home" aria-label={storeName}>
            <span className="brand-mark">
              <Leaf size={24} />
            </span>
            <span>
              <span className="brand-word">{storeName}</span>
              <span className="brand-sub">A softer kind of green</span>
            </span>
          </a>
          <nav className="nav-links">
            <a href="#shop">{t.shop}</a>
            <a href="#ritual">{t.ritual}</a>
            <a href="#story">{t.story}</a>
          </nav>
          <div className="header-actions">
            <select
              className="lang-button"
              aria-label={t.language}
              value={lang}
              onChange={(event) => {
                if (isLanguage(event.target.value)) setLang(event.target.value);
              }}
            >
              <option value="zh">中文</option>
              <option value="en">English</option>
              <option value="ms">Bahasa Melayu</option>
            </select>
            <button
              className="mm-icon"
              aria-label={t.favorites}
              aria-pressed={savedOnly}
              onClick={() => {
                setSavedOnly(!savedOnly);
                document
                  .getElementById("shop")
                  ?.scrollIntoView({ behavior: "smooth" });
              }}
            >
              <Heart size={18} fill={savedOnly ? "currentColor" : "none"} />
            </button>
            <button className="orders-button" onClick={openOrders}>
              {t.orders}
            </button>
            <button className="bag-button" onClick={() => setModal("cart")}>
              <ShoppingBag size={15} />
              <span>{t.bag}</span>
              <span className="bag-count">
                {cart.reduce((sum, item) => sum + item.quantity, 0)}
              </span>
            </button>
          </div>
        </div>
      </header>
      <main id="storeView">
        <div className="page-wrap">
          <section
            className="hero"
            id="home"
            style={{ display: hero.enabled === false ? "none" : undefined }}
          >
            <div className="hero-copy">
              <div className="eyebrow">{t.origin}</div>
              <h1 className="serif mm-hero-title">
                {localized(lang, hero.title, hero.titleEN, hero.titleMS)
                  .split("\n")
                  .map((line, index) => (
                    <span key={index}>
                      {index > 0 && <br />}
                      {line}
                    </span>
                  ))}
              </h1>
              <p>
                {localized(
                  lang,
                  hero.description,
                  hero.descriptionEN,
                  hero.descriptionMS,
                ).replaceAll("Mori Matcha", storeName)}
              </p>
              <div className="hero-actions">
                <a className="primary-button" href="#shop">
                  {t.explore}
                  <span className="round-arrow">
                    <ArrowUpRight size={17} />
                  </span>
                </a>
                <button className="secondary-button" onClick={openContact}>
                  {t.contact}
                </button>
              </div>
              <div className="hero-notes">
                {t.notes.map((note) => (
                  <span key={note}>
                    <i />
                    {note}
                  </span>
                ))}
              </div>
            </div>
            <div className="hero-visual">
              <div className="floating-chip">
                <Leaf size={13} /> TONGREN · GUIZHOU
              </div>
              <div className="hero-product-card">
                <div className="hero-product-image">
                  <img src={hero.image} alt={t.powder} />
                </div>
                <div className="hero-product-foot">
                  <div>
                    <strong>{t.powder}</strong>
                    <small>{t.size}</small>
                  </div>
                  <span className="mm-origin-seal">
                    铜<br />仁
                  </span>
                </div>
              </div>
            </div>
          </section>
          <section className="mm-platforms" aria-label={t.buyElsewhere}>
            <strong>{t.buyElsewhere}</strong>
            {platforms.map((platform) =>
              platform.url ? (
                <a
                  key={platform.name}
                  className="mm-btn light"
                  href={platform.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {platform.name}
                  <ArrowUpRight size={15} />
                </a>
              ) : (
                <span key={platform.name} className="mm-platform-unavailable">
                  {platform.name} ·{" "}
                  {catalogLoaded
                    ? t.notConfigured
                    : error
                      ? t.requestFailed
                      : t.loading}
                </span>
              ),
            )}
            <button className="mm-text-link" onClick={openContact}>
              {t.contact}
              <ArrowUpRight size={14} />
            </button>
            <small>{t.externalNotice}</small>
          </section>
          <section className="section" id="shop">
            <div className="section-heading">
              <div>
                <div className="section-kicker">THE MATCHA SHELF</div>
                <h2 className="serif">
                  {savedOnly ? t.favorites : t.collection}
                </h2>
              </div>
              <p>{t.intro}</p>
            </div>
            <div className="shop-tools">
              <div className="filters">
                {[
                  { id: "all", label: t.all },
                  ...categories.map((category) => ({
                    id: category.id,
                    label: categoryName(category.id),
                  })),
                ].map((item) => (
                  <button
                    key={item.id}
                    className={`filter-button ${effectiveFilter === item.id ? "active" : ""}`}
                    onClick={() => setFilter(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <label className="search-box">
                <Search size={16} />
                <input
                  aria-label={t.search}
                  placeholder={t.search}
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
            </div>
            {error && (
              <div className="mm-notice" role="alert">
                {lang === "zh" ? error : t.requestFailed}{" "}
                <button
                  onClick={() =>
                    void reload().catch((cause) =>
                      setError(
                        cause instanceof Error
                          ? cause.message
                          : t.requestFailed,
                      ),
                    )
                  }
                >
                  {t.reload}
                </button>
              </div>
            )}
            <div className="mm-products">
              {visible.map((product) => (
                <article className="mm-product mm-reveal" key={product.id}>
                  <div className="mm-product-photo">
                    <button
                      className="mm-product-photo-link"
                      onClick={() => openProduct(product)}
                      aria-label={productName(product)}
                    >
                      <img
                        src={variantImage(product, product.variants[0])}
                        alt={productName(product)}
                        loading="lazy"
                      />
                    </button>
                    <span className="mm-product-tag">
                      {categoryName(product.category)} ·{" "}
                      {product.variants
                        .map((variant) => variant.label)
                        .join(" / ")}
                    </span>
                    <button
                      className={`mm-heart ${favorites.includes(product.id) ? "selected" : ""}`}
                      aria-label={`${t.favorites} ${productName(product)}`}
                      aria-pressed={favorites.includes(product.id)}
                      onClick={() =>
                        setFavorites((current) =>
                          current.includes(product.id)
                            ? current.filter((id) => id !== product.id)
                            : [...current, product.id],
                        )
                      }
                    >
                      <Heart
                        size={20}
                        fill={
                          favorites.includes(product.id)
                            ? "currentColor"
                            : "none"
                        }
                      />
                    </button>
                  </div>
                  <div className="mm-product-copy">
                    <div className="section-kicker">{storeName} · TONGREN</div>
                    <h3>{productName(product)}</h3>
                    <p>{description(product)}</p>
                    <div className="mm-variants">
                      {product.variants.map((variant) => (
                        <span key={variant.id}>
                          {variant.label} · {money(variant.price)}
                        </span>
                      ))}
                    </div>
                    <div className="mm-product-bottom">
                      <strong>
                        {money(
                          Math.min(
                            ...product.variants.map((variant) => variant.price),
                          ),
                        )}
                        {product.variants.length > 1 && <small> +</small>}
                      </strong>
                      <button
                        className="mm-add"
                        disabled={
                          !product.variants.some((variant) => variant.stock > 0)
                        }
                        onClick={() =>
                          product.variants.length > 1
                            ? openProduct(product)
                            : add(product, product.variants[0].id)
                        }
                      >
                        {product.variants.some((variant) => variant.stock > 0)
                          ? t.add
                          : t.out}
                        <Plus size={17} />
                      </button>
                    </div>
                    <button
                      className="mm-text-link"
                      onClick={() => openProduct(product)}
                    >
                      {t.detail} <ArrowUpRight size={13} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
            {!visible.length && (
              <div className="mm-empty">
                <Leaf />
                {catalogLoaded ? t.empty : error ? t.requestFailed : t.loading}
                {catalogLoaded && (
                  <button
                    onClick={() => {
                      setQuery("");
                      setFilter("all");
                      setSavedOnly(false);
                    }}
                  >
                    {t.all}
                  </button>
                )}
              </div>
            )}
            <p className="demo-price-note">{t.sample}</p>
          </section>
          <section className="mm-ritual mm-reveal" id="ritual">
            {t.steps.map((step, index) => (
              <div key={step}>
                <span className="mm-step">0{index + 1}</span>
                <h3>{step}</h3>
                <p>{t.stepDesc[index]}</p>
              </div>
            ))}
          </section>
          <section className="mm-story mm-reveal" id="story">
            <div className="mm-story-art">
              <img
                src="/assets/background.jpg"
                alt={t.teaGarden}
                loading="lazy"
              />
              <span>
                TEA LEAF ORIGIN<strong>贵州 · 铜仁</strong>
              </span>
            </div>
            <div className="mm-story-copy">
              <div className="section-kicker">ROOTED IN TONGREN</div>
              <h2 className="serif">
                {t.storyTitle.split("\n").map((line, index) => (
                  <span key={index}>
                    {line}
                    <br />
                  </span>
                ))}
              </h2>
              <p>{t.storyCopy.replaceAll("Mori Matcha", storeName)}</p>
              <a className="primary-button" href="#shop">
                {t.shopRange}
                <ArrowUpRight size={17} />
              </a>
            </div>
          </section>
        </div>
      </main>
      <footer className="mm-footer">
        <a href="#home" className="brand-word">
          {storeName}
        </a>
        <p>A softer kind of green. From Tongren, with care.</p>
        <div>
          <a href="#shop">{t.shop}</a>
          <button onClick={() => setModal("policy")}>{t.policies}</button>
          <button onClick={openContact}>{t.contact}</button>
          <a href="#home" aria-label={t.backTop}>
            ↑
          </a>
        </div>
        <small>{storeName}</small>
      </footer>

      {modal === "cart" && (
        <Modal title={t.bag} onClose={close}>
          {!cart.length ? (
            <div className="mm-empty">
              <ShoppingBag />
              {t.empty}
              <button className="mm-btn" onClick={close}>
                {t.shop}
              </button>
            </div>
          ) : (
            <>
              {hasPendingOrder && (
                <p className="mm-notice">{t.pendingOrderNotice}</p>
              )}
              {!catalogLoaded && (
                <p className="mm-notice">
                  {error ? t.requestFailed : t.loading}
                </p>
              )}
              {unavailableItems.map((item) => (
                <div className="mm-notice" key={item.skuId}>
                  {t.unavailable}
                  <button
                    className="mm-text-link"
                    onClick={() =>
                      updateCart((current) =>
                        current.filter((entry) => entry.skuId !== item.skuId),
                      )
                    }
                  >
                    {t.remove}
                  </button>
                </div>
              ))}
              {stockExceeded && (
                <p className="mm-error" role="alert">
                  {t.stockChanged}
                </p>
              )}
              <div className="mm-cart-list">
                {cartItems.map((item) => (
                  <div className="mm-cart-row" key={item.skuId}>
                    <img
                      src={variantImage(item.product, item.variant)}
                      alt=""
                    />
                    <div>
                      <strong>{productName(item.product)}</strong>
                      <small>
                        {item.variant.label} · {money(item.variant.price)}
                      </small>
                      <div className="mm-quantity">
                        <button
                          aria-label={t.decrease}
                          onClick={() => changeQuantity(item.skuId, -1)}
                        >
                          <Minus size={13} />
                        </button>
                        <span>{item.quantity}</span>
                        <button
                          aria-label={t.increase}
                          disabled={
                            item.quantity >= Math.min(100, item.variant.stock)
                          }
                          onClick={() => changeQuantity(item.skuId, 1)}
                        >
                          <Plus size={13} />
                        </button>
                      </div>
                    </div>
                    <div>
                      <strong>
                        {money(item.quantity * item.variant.price)}
                      </strong>
                      <button
                        className="mm-text-link"
                        aria-label={t.remove}
                        onClick={() =>
                          updateCart((current) =>
                            current.filter(
                              (entry) => entry.skuId !== item.skuId,
                            ),
                          )
                        }
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mm-total">
                <span>{t.subtotal}</span>
                <strong>{money(subtotal)}</strong>
              </div>
              <p className="mm-muted">{t.sample}</p>
              {!catalog.shipping.length && (
                <p className="mm-notice">{t.shippingUnavailable}</p>
              )}
              <button
                className="mm-btn full"
                disabled={busy || (!canCheckout && !hasPendingOrder)}
                onClick={checkout}
              >
                {hasPendingOrder ? t.recoverOrder : t.checkout}
                <ArrowUpRight size={17} />
              </button>
            </>
          )}
        </Modal>
      )}

      {modal === "product" && selected && (
        <Modal title={productName(selected)} onClose={close} wide>
          <div className="mm-detail">
            <div>
              <img
                className="mm-detail-main"
                src={detailImage}
                alt={`${productName(selected)} · ${selectedVariant?.label || ""}`}
              />
              <div className="mm-thumbnails">
                {Array.from(
                  new Set([
                    ...selected.images,
                    ...selected.variants
                      .map((variant) => variant.image)
                      .filter((image): image is string => !!image),
                  ]),
                ).map((image, index) => (
                  <button
                    key={image}
                    onClick={() => setGalleryImage(image)}
                    aria-label={`${t.image} ${index + 1}`}
                    aria-pressed={image === detailImage}
                  >
                    <img src={image} alt="" />
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p>{description(selected)}</p>
              <div className="mm-detail-variants">
                {selected.variants.map((variant) => (
                  <button
                    key={variant.id}
                    className={variant.id === variantId ? "selected" : ""}
                    aria-pressed={variant.id === variantId}
                    onClick={() => {
                      setVariantId(variant.id);
                      setGalleryImage("");
                    }}
                  >
                    {variant.label} · {money(variant.price)}
                  </button>
                ))}
              </div>
              <p className="mm-muted">
                {t.available}: {selectedVariant?.stock ?? 0}
              </p>
              <button
                className="mm-btn full"
                disabled={!selectedVariant?.stock}
                onClick={() => add(selected, variantId)}
              >
                {selectedVariant?.stock ? t.add : t.out}
                <Plus size={17} />
              </button>
              <dl className="mm-specs">
                <dt>{t.originLabel}</dt>
                <dd>{selected.origin}</dd>
                <dt>{t.ingredients}</dt>
                <dd>{selected.ingredients}</dd>
                <dt>{t.storage}</dt>
                <dd>{selected.storage}</dd>
              </dl>
              <p className="mm-muted">{t.sample}</p>
            </div>
          </div>
          {selected.detailImages.map((image, index) => (
            <img
              key={`${image}-${index}`}
              className="mm-detail-image"
              src={image}
              alt={`${t.detail} ${index + 1}`}
              loading="lazy"
            />
          ))}
          {catalog.reviews
            .filter((review) => review.productId === selected.id)
            .map((review) => (
              <blockquote className="mm-review" key={review.id}>
                <span aria-label={`${t.rating}: ${review.rating}/5`}>
                  {"★".repeat(Math.max(0, Math.min(5, review.rating)))}
                </span>
                <p>{review.text}</p>
                {review.reply && (
                  <div className="mm-notice">
                    <strong>{t.merchantReply}</strong>
                    <p>{review.reply}</p>
                  </div>
                )}
              </blockquote>
            ))}
        </Modal>
      )}

      {modal === "checkout" && (
        <Modal title={t.checkoutTitle} onClose={close}>
          <div className="mm-notice">{t.testNotice}</div>
          {hasPendingOrder && (
            <div className="mm-notice">
              {t.pendingOrderNotice}
              <button
                className="mm-btn light full"
                disabled={busy}
                onClick={checkout}
              >
                {t.recoverOrder}
              </button>
            </div>
          )}
          <form onSubmit={submitOrder} className="mm-form" id="checkout-form">
            {addresses.length > 0 && (
              <label className="full">
                {t.savedAddresses}
                <select
                  defaultValue=""
                  onChange={(event) => {
                    const address = addresses.find(
                      (item) => item.id === event.target.value,
                    );
                    const form = document.getElementById(
                      "checkout-form",
                    ) as HTMLFormElement | null;
                    if (address && form)
                      for (const key of [
                        "name",
                        "phone",
                        "address",
                        "city",
                        "state",
                        "postcode",
                      ] as const) {
                        const field = form.elements.namedItem(key);
                        if (
                          field instanceof HTMLInputElement ||
                          field instanceof HTMLTextAreaElement
                        )
                          field.value = address[key];
                      }
                  }}
                >
                  <option value="">{t.chooseAddress}</option>
                  {addresses.map((address) => (
                    <option key={address.id} value={address.id}>
                      {address.name} · {address.address}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {[
              {
                key: "name",
                label: t.recipient,
                type: "text",
                autocomplete: "name",
              },
              {
                key: "phone",
                label: t.phone,
                type: "tel",
                autocomplete: "tel",
              },
              {
                key: "email",
                label: t.email,
                type: "email",
                autocomplete: "email",
              },
              {
                key: "city",
                label: t.city,
                type: "text",
                autocomplete: "address-level2",
              },
              {
                key: "state",
                label: t.state,
                type: "text",
                autocomplete: "address-level1",
              },
              {
                key: "postcode",
                label: t.postcode,
                type: "text",
                autocomplete: "postal-code",
              },
            ].map((field) => (
              <label key={field.key}>
                {field.label}
                <input
                  name={field.key}
                  type={field.type}
                  autoComplete={field.autocomplete}
                  required
                  maxLength={field.key === "postcode" ? 5 : 160}
                  defaultValue={
                    field.key === "email" ? session?.user?.email : ""
                  }
                  pattern={field.key === "postcode" ? "[0-9]{5}" : undefined}
                  inputMode={field.key === "postcode" ? "numeric" : undefined}
                />
              </label>
            ))}
            <label className="full">
              {t.address}
              <textarea
                name="address"
                autoComplete="street-address"
                required
                minLength={5}
                maxLength={500}
              />
            </label>
            <label className="full">
              {t.note}
              <input name="note" maxLength={500} />
            </label>
            <label className="full">
              {t.delivery}
              <select
                value={shippingId}
                onChange={(event) => setShippingId(event.target.value)}
                required
              >
                {catalog.shipping.map((method) => (
                  <option key={method.id} value={method.id}>
                    {method.name} · {money(method.fee)}
                    {method.freeAbove > 0
                      ? ` · ${t.freeAbove} ${money(method.freeAbove)}`
                      : ""}
                  </option>
                ))}
              </select>
            </label>
            <div className="full mm-inline">
              <input
                aria-label={t.coupon}
                value={coupon}
                placeholder={t.coupon}
                onChange={(event) => {
                  setCoupon(event.target.value);
                  setDiscount(0);
                }}
              />
              <button
                type="button"
                className="mm-btn light"
                disabled={busy || !coupon}
                onClick={() =>
                  run(async () => {
                    const quote = await api<{ discount: number }>(
                      "/coupon/quote",
                      "POST",
                      { code: coupon, subtotal },
                    );
                    setDiscount(quote.discount);
                    notify(t.applied);
                  })
                }
              >
                {t.apply}
              </button>
            </div>
            <label className="full mm-check">
              <input type="checkbox" name="saveAddress" />
              {t.saveAddress}
            </label>
            <label className="full mm-check">
              <input type="checkbox" required />
              {t.demoAck}
            </label>
            <div className="full mm-bill">
              <span>
                {t.subtotal}
                <b>{money(subtotal)}</b>
              </span>
              <span>
                {t.discount}
                <b>− {money(discount)}</b>
              </span>
              <span>
                {t.delivery}
                <b>{money(shippingFee)}</b>
              </span>
              <strong>
                {t.total}
                <b>{money(total)}</b>
              </strong>
            </div>
            {!canCheckout && (
              <p className="mm-error full">
                {stockExceeded
                  ? t.stockChanged
                  : unavailableItems.length
                    ? t.unavailable
                    : t.notReady}
              </p>
            )}
            <button
              className="mm-btn full"
              type="submit"
              disabled={busy || !canCheckout}
            >
              {busy ? t.submitting : t.placeOrder}
            </button>
          </form>
        </Modal>
      )}

      {modal === "success" && success && (
        <Modal title={t.orderCreated} onClose={close}>
          <div className="mm-empty">
            <Check size={36} />
            <h3>{success.id}</h3>
            <p>
              {money(success.total)} · {orderStatus(success.status, lang)}
            </p>
            <p className="mm-muted">{t.noPayment}</p>
            {success.status === "pending_payment" && success.expiresAt && (
              <p>
                {t.expires}: {date(success.expiresAt)}
              </p>
            )}
            <button className="mm-btn" onClick={openOrders}>
              {t.orders}
            </button>
          </div>
        </Modal>
      )}
      {modal === "orders" && (
        <Modal title={t.orders} onClose={close} wide>
          {busy && <p>{t.loading}</p>}
          {!busy && !orders.length && (
            <div className="mm-empty">
              <Package />
              {t.noOrders}
            </div>
          )}
          {orders.map((order) => (
            <div className="mm-order" key={order.id}>
              <div className="mm-between">
                <strong>{order.id}</strong>
                <span className="mm-badge">
                  {orderStatus(order.status, lang)}
                </span>
              </div>
              <small>
                {date(order.createdAt)} · {t.testOrder}
              </small>
              {order.items.map((item) => (
                <div className="mm-between" key={item.skuId}>
                  <span>
                    {item.name} · {item.label} × {item.quantity}
                  </span>
                  <b>{money(item.price * item.quantity)}</b>
                </div>
              ))}
              <div className="mm-between">
                <span>
                  {order.carrier} {order.tracking}
                </span>
                <strong>{money(order.total)}</strong>
              </div>
              {order.status === "pending_payment" && order.expiresAt && (
                <p className="mm-muted">
                  {t.expires}: {date(order.expiresAt)}
                </p>
              )}
              {order.cancellationReason === "expired" && (
                <p className="mm-notice">{t.expired}</p>
              )}
              {aftersales
                .filter((request) => request.orderId === order.id)
                .map((request) => (
                  <div className="mm-notice" key={request.id}>
                    {t.aftersales}: {orderStatus(request.status, lang)}{" "}
                    {request.reply}
                    <small>{t.refundNotice}</small>
                  </div>
                ))}
              <div className="mm-actions">
                {order.status === "pending_payment" && (
                  <button
                    className="mm-btn light"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await api(`/orders/${order.id}/cancel`, "POST", {});
                        setOrders(await api<Order[]>("/orders"));
                        await reload();
                      })
                    }
                  >
                    {t.cancel}
                  </button>
                )}
                {!["pending_payment", "cancelled"].includes(order.status) && (
                  <button
                    className="mm-btn light"
                    onClick={() => {
                      setActiveOrder(order);
                      setModal("aftersales");
                    }}
                  >
                    {t.aftersales}
                  </button>
                )}
                {order.status === "completed" && (
                  <button
                    className="mm-btn light"
                    onClick={() => {
                      setActiveOrder(order);
                      setModal("review");
                    }}
                  >
                    {t.review}
                  </button>
                )}
              </div>
            </div>
          ))}
        </Modal>
      )}
      {modal === "aftersales" && activeOrder && (
        <Modal title={t.aftersales} onClose={close}>
          <form
            className="mm-form"
            onSubmit={(event) => {
              event.preventDefault();
              const form = Object.fromEntries(
                new FormData(event.currentTarget),
              );
              void run(async () => {
                await api(`/orders/${activeOrder.id}/aftersales`, "POST", {
                  reason: form.reason,
                  description: form.description,
                  amount: Math.round(Number(form.amount) * 100),
                });
                notify(t.requestSubmitted);
                await openOrders();
              });
            }}
          >
            <label className="full">
              {t.reason}
              <input required name="reason" maxLength={160} />
            </label>
            <label className="full">
              {t.issue}
              <textarea name="description" maxLength={3000} />
            </label>
            <label className="full">
              {t.amount} (RM)
              <input
                name="amount"
                type="number"
                min="0.01"
                max={activeOrder.total / 100}
                step="0.01"
                required
                defaultValue={(activeOrder.total / 100).toFixed(2)}
              />
            </label>
            <p className="mm-notice full">{t.aftersalesNotice}</p>
            <button className="mm-btn full" disabled={busy}>
              {t.submit}
            </button>
          </form>
        </Modal>
      )}
      {modal === "review" && activeOrder && (
        <Modal title={t.review} onClose={close}>
          <form
            className="mm-form"
            onSubmit={(event) => {
              event.preventDefault();
              const form = Object.fromEntries(
                new FormData(event.currentTarget),
              );
              void run(async () => {
                await api("/reviews", "POST", {
                  ...form,
                  orderId: activeOrder.id,
                  rating: Number(form.rating),
                });
                notify(t.reviewSubmitted);
                close();
              });
            }}
          >
            <label className="full">
              {t.product}
              <select name="productId">
                {activeOrder.items
                  .filter(
                    (item, index, items) =>
                      items.findIndex(
                        (other) => other.productId === item.productId,
                      ) === index,
                  )
                  .map((item) => (
                    <option key={item.productId} value={item.productId}>
                      {item.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="full">
              {t.rating}
              <select name="rating">
                {[5, 4, 3, 2, 1].map((rating) => (
                  <option key={rating} value={rating}>
                    {"★".repeat(rating)}
                  </option>
                ))}
              </select>
            </label>
            <label className="full">
              {t.review}
              <textarea name="text" required maxLength={3000} />
            </label>
            <button className="mm-btn full" disabled={busy}>
              {t.submit}
            </button>
          </form>
        </Modal>
      )}

      {modal === "contact" && (
        <Modal title={t.contact} onClose={close}>
          <p className="mm-muted">{t.guestContact}</p>
          <p className="mm-contact-details">
            {catalog.settings?.contact ||
              (!catalogLoaded
                ? error
                  ? t.requestFailed
                  : t.loading
                : !whatsappUrl
                  ? t.contactUnavailable
                  : "")}
          </p>
          {whatsappUrl ? (
            <a
              className="mm-btn full"
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t.whatsapp}
              <ArrowUpRight size={17} />
            </a>
          ) : (
            <p className="mm-muted">
              WhatsApp ·{" "}
              {catalogLoaded
                ? t.notConfigured
                : error
                  ? t.requestFailed
                  : t.loading}
            </p>
          )}
          {session?.user ? (
            <>
              <form
                className="mm-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = event.currentTarget;
                  const message = Object.fromEntries(new FormData(form));
                  void run(async () => {
                    await api("/tickets", "POST", message);
                    form.reset();
                    notify(t.sent);
                    setTickets(await api<Ticket[]>("/tickets"));
                  });
                }}
              >
                <label className="full">
                  {t.subject}
                  <input name="subject" required maxLength={160} />
                </label>
                <label className="full">
                  {t.message}
                  <textarea name="message" required maxLength={3000} />
                </label>
                <button className="mm-btn full" disabled={busy}>
                  {t.send}
                </button>
              </form>
              {tickets.map((ticket) => (
                <div className="mm-order" key={ticket.id}>
                  <strong>{ticket.subject}</strong>
                  <p>{ticket.message}</p>
                  <p className="mm-notice">{ticket.reply || t.waitingReply}</p>
                </div>
              ))}
            </>
          ) : (
            <button className="mm-btn light full" onClick={signIn}>
              {t.signInMessage}
            </button>
          )}
        </Modal>
      )}
      {modal === "policy" && (
        <Modal title={t.policies} onClose={close}>
          <h3>{t.delivery}</h3>
          {catalog.shipping.length ? (
            catalog.shipping.map((method) => (
              <p key={method.id}>
                {method.name} · {money(method.fee)}
                {method.freeAbove > 0
                  ? ` · ${t.freeAbove} ${money(method.freeAbove)}`
                  : ""}
              </p>
            ))
          ) : (
            <p>{t.shippingUnavailable}</p>
          )}
          <h3>{t.aftersales}</h3>
          <p className="mm-contact-details">
            {catalog.settings?.returnsPolicy || t.returnsFallback}
          </p>
          <h3>{t.privacy}</h3>
          <p className="mm-contact-details">
            {catalog.settings?.privacyPolicy || t.privacyFallback}
          </p>
          <p className="mm-muted">{t.sample}</p>
        </Modal>
      )}
      {toast && (
        <div className="mm-toast" role="status">
          {toast}
        </div>
      )}
    </>
  );
}
