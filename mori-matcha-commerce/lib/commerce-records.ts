// JSON-backed records have one schema per module. Database reads retain that
// module's shape so catalogue and administration do not expose arbitrary data.
export interface RecordMeta {
  id: string;
  revision: number;
}
type ActiveStatus = "active" | "disabled";
export interface RecordTypes {
  categories: {
    name: string;
    nameEN: string;
    nameMS: string;
    status: ActiveStatus;
  };
  coupons: {
    name: string;
    code: string;
    discount: number;
    minimum: number;
    expires: string;
    status: ActiveStatus;
  };
  shipping: {
    name: string;
    fee: number;
    freeAbove: number;
    countries: string;
    status: ActiveStatus;
  };
  content: {
    title: string;
    titleEN: string;
    titleMS: string;
    description: string;
    descriptionEN: string;
    descriptionMS: string;
    image: string;
    enabled: boolean;
  };
  settings: {
    name: string;
    currency: string;
    contact: string;
    shopeeUrl: string;
    tiktokUrl: string;
    whatsappUrl: string;
    lowStock: number;
    announcement: string;
    returnsPolicy: string;
    privacyPolicy: string;
  };
  customers: {
    userId: string;
    name: string;
    email: string;
    tags: string;
    note: string;
    status: ActiveStatus;
  };
  reviews: {
    orderId: string;
    productId: string;
    userId: string;
    rating: number;
    text: string;
    status: string;
    reply: string;
    createdAt: string;
  };
  aftersales: {
    orderId: string;
    userId: string;
    reason: string;
    description: string;
    amount: number;
    status: string;
    reply: string;
    createdAt: string;
    isDemo: boolean;
  };
  tickets: {
    subject: string;
    message: string;
    userId: string;
    email: string;
    status: string;
    reply: string;
    createdAt: string;
  };
  addresses: {
    userId: string;
    name: string;
    phone: string;
    address: string;
    city: string;
    state: string;
    postcode: string;
  };
}
export type RecordKind = keyof RecordTypes;
export interface ProductRow {
  id: string;
  data: string;
  revision: number;
}
export interface OrderRow {
  id: string;
  owner_id: string;
  idempotency_key: string;
  data: string;
  total: number;
  status: string;
  payment_status: string;
  created_at: string;
  is_demo: number;
  expires_at: string | null;
  cancellation_reason: string;
  revision: number;
}
