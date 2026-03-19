export type GTClinic = {
  id: string;
  name: string;
  code?: string | null;
  currency?: string | null;
  address?: string | null;
  phoneNumber?: string | null;
};

export type GTService = {
  id: string;
  name: string;
  description?: string | null;
  metadata?: string | null;
  durationMinutes: number;
  maxDurationCount?: number | null;
  intervalDay?: number | null;
  price: number;
  originalPrice: number;
  status: string;
};

export type GTProductStockItem = {
  id: string;
  name: string;
  stock: number;
  price: number;
  originalPrice: number;
  status: string;
  stockControlUnit: boolean;
  serviceStock?: number | null;
  barcode?: string | null;
  sku?: string | null;
};

export type GTProduct = {
  id: string;
  name: string;
  status: string;
  description?: string | null;
  stockItem?: GTProductStockItem | null;
};

export type GTPractitioner = {
  id: string;
  name: string;
  status: string;
  phoneNumber?: string | null;
  sex?: string | null;
  imageUrl?: string | null;
  metadata?: string | null;
};

export type GTMember = {
  id: string;
  name: string;
  phoneNumber?: string | null;
  memberCode?: string | null;
  metadata?: string | null;
  note?: string | null;
};

export type GTServiceProductLink = {
  id: string;
  serviceId: string;
  serviceName: string;
  serviceProductStockItemId: string;
  serviceProductStockItemName: string;
  productStockItemId: string;
  productName: string;
  amountPerService?: number | null;
  amountPerProduct?: number | null;
  productPrice?: number | null;
  productStock?: number | null;
};

export type GTCatalogSnapshot = {
  clinic: GTClinic;
  services: GTService[];
  products: GTProduct[];
  practitioners: GTPractitioner[];
  serviceProductLinks: GTServiceProductLink[];
  loadedAt: string;
};

export type GTBookingSummary = {
  id: string;
  status: string;
  serviceId: string;
  serviceName?: string | null;
  memberId: string;
  memberName?: string | null;
  practitionerId: string;
  practitionerName?: string | null;
  fromTime: string;
  toTime: string;
  metadata?: string | null;
};

export type GTBookingMutationPayload = {
  clinicId: string;
  serviceId: string;
  memberId: string;
  practitionerId: string;
  scheduledAt: string;
  durationMinutes: number;
  userId: string;
  note?: string;
  serviceRoomId?: string;
  serviceHelperId?: string;
  checkPractitionerAvailability?: boolean;
  metadata?: string;
};

export type GTBookingUpdatePayload = {
  bookingId: string;
  status?: string;
  practitionerId?: string;
  serviceId?: string;
  fromTime?: string;
  toTime?: string;
  metadata?: string;
};

export type GTSaleDraftLineItem = {
  refId: string;
  refType: "SERVICE" | "PRODUCT";
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
  practitionerId?: string;
  metadata?: string;
};

export type GTSaleMutationPayload = {
  clinicId: string;
  memberId: string;
  userId: string;
  sellerId?: string;
  paymentMethod: "CASH" | "CARD" | "WAVEPAY" | "KBZPAY" | "AYAPAY" | "SPLIT" | "PASS";
  paymentStatus: "PAID" | "PARTIAL_PAID" | "UNPAID";
  orderNumber?: string;
  note?: string;
  lineItems: GTSaleDraftLineItem[];
};

export type GTSaleExecutionResult = {
  id: string;
  orderId?: string | null;
  paymentStatus?: string | null;
};

export type GTReportPeriod = {
  label: string;
  fromDate: string;
  toDate: string;
};
