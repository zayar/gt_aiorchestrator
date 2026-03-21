import { config } from "../config/index.js";
import type {
  GTBookingMutationPayload,
  GTBookingSummary,
  GTBookingUpdatePayload,
  GTClinic,
  GTMember,
  GTPractitioner,
  GTProduct,
  GTService,
  GTServiceProductLink,
  GTSaleExecutionResult,
  GTSaleMutationPayload,
} from "../types/domain.js";
import type { GTSessionContext } from "../types/session.js";
import { AppError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

type GraphqlErrorItem = {
  message?: string;
  extensions?: Record<string, unknown>;
};

type GraphqlPayload<TData> = {
  data?: TData;
  errors?: GraphqlErrorItem[];
};

type GTAuthRefreshResult = {
  gtAuthRefresh: {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  } | null;
};

const GT_AUTH_REFRESH = `
  mutation GtAuthRefresh($refreshToken: String!) {
    gtAuthRefresh(refresh_token: $refreshToken) {
      accessToken
      refreshToken
      expiresIn
    }
  }
`;

const CLINIC_QUERY = `
  query Clinic($where: ClinicWhereUniqueInput!) {
    clinic(where: $where) {
      id
      name
      code
      currency
      address
      phonenumber
    }
  }
`;

const SERVICES_QUERY = `
  query Services($where: ServiceWhereInput) {
    services(where: $where) {
      id
      name
      description
      metadata
      duration
      max_duration_count
      interval_day
      price
      original_price
      status
    }
  }
`;

const PRODUCTS_QUERY = `
  query Products($where: ProductWhereInput, $take: Int) {
    products(where: $where, take: $take) {
      id
      name
      status
      description
      product_stock_item(take: 1) {
        id
        name
        stock
        stock_control_unit
        status
        price
        original_price
        supply_price
        service_stock
        barcode
        sku
      }
    }
  }
`;

const PRACTITIONERS_QUERY = `
  query Practitioners($where: PractitionerWhereInput) {
    practitioners(where: $where) {
      id
      name
      status
      phonenumber
      sex
      image
      metadata
    }
  }
`;

const MEMBERS_QUERY = `
  query GetMembers($clinicId: String!, $search: String, $version: String) {
    getMembers(clinicId: $clinicId, search: $search, version: $version) {
      id
      name
      phonenumber
      member_id
      metadata
      note
    }
  }
`;

const CLINIC_MEMBER_REFERENCE_QUERY = `
  query MembersReference(
    $where: MemberWhereInput
    $orderBy: [MemberOrderByWithRelationInput!]
    $take: Int
    $clinicMembersWhere2: ClinicMemberWhereInput
  ) {
    members(where: $where, orderBy: $orderBy, take: $take) {
      id
      name
      phonenumber
      member_id
      metadata
      note
      clinic_members(where: $clinicMembersWhere2) {
        name
        phonenumber
        member_id
        metadata
        note
      }
    }
  }
`;

const MEMBER_BY_ID_QUERY = `
  query Member($where: MemberWhereUniqueInput!, $clinicMembersWhere2: ClinicMemberWhereInput) {
    member(where: $where) {
      id
      name
      phonenumber
      member_id
      metadata
      note
      clinic_members(where: $clinicMembersWhere2) {
        id
        name
        phonenumber
        member_id
        metadata
        note
      }
    }
  }
`;

const SERVICE_PRACTITIONERS_QUERY = `
  query GetServicePractioners($serviceId: String!, $fromTime: DateTime, $toTime: DateTime) {
    getServicePractioners(service_id: $serviceId, from_time: $fromTime, to_time: $toTime) {
      id
      name
      status
      phonenumber
      sex
      image
      metadata
    }
  }
`;

const SERVICE_PRODUCT_ITEMS_QUERY = `
  query ServiceProductStockItems($where: ServiceProductStockItemWhereInput, $take: Int) {
    serviceProductStockItems(where: $where, take: $take) {
      id
      name
      amount_per_product
      stock
      product_stock_item_id
      product_stock_item {
        id
        name
        stock
        price
        original_price
        status
      }
    }
  }
`;

const SERVICE_PRODUCT_USAGES_QUERY = `
  query ServiceProductStockItemUsages($where: ServiceProductStockItemUsageWhereInput, $take: Int) {
    serviceProductStockItemUsages(where: $where, take: $take) {
      id
      amount_per_service
      service_id
      service {
        id
        name
      }
      service_product_stock_item_id
      service_product_stock_item {
        id
        name
        product_stock_item_id
        product_stock_item {
          id
          name
          stock
          price
          original_price
          status
        }
      }
    }
  }
`;

const CREATE_BOOKING_MUTATION = `
  mutation CreateNewBooking(
    $clinicId: String!
    $serviceId: String!
    $memberId: String!
    $practitionerId: String!
    $date: DateTime!
    $userId: String!
    $status: BookingStatus!
    $note: String
    $serviceRoomId: String
    $serviceHelperId: String
    $channel: BookingChannel
    $duration: Int
    $checkPractitionerAvailability: Boolean
    $metadata: String
  ) {
    createNewBooking(
      clinic_id: $clinicId
      service_id: $serviceId
      member_id: $memberId
      practitioner_id: $practitionerId
      date: $date
      user_id: $userId
      status: $status
      note: $note
      service_room_id: $serviceRoomId
      service_helper_id: $serviceHelperId
      channel: $channel
      duration: $duration
      check_practitioner_availability: $checkPractitionerAvailability
      metadata: $metadata
    ) {
      id
      status
      from_time
      to_time
      service_id
      member_id
      practitioner_id
    }
  }
`;

const UPDATE_BOOKING_MUTATION = `
  mutation UpdateOneBooking($data: BookingUpdateInput!, $where: BookingWhereUniqueInput!) {
    updateOneBooking(data: $data, where: $where) {
      id
      status
      from_time
      to_time
      service_id
      member_id
      practitioner_id
      metadata
    }
  }
`;

const BOOKING_BY_ID_QUERY = `
  query Booking($where: BookingWhereUniqueInput!) {
    booking(where: $where) {
      id
      status
      from_time
      to_time
      service_id
      member_id
      practitioner_id
      metadata
      service {
        id
        name
      }
      member {
        id
        name
        phonenumber
      }
      practitioner {
        id
        name
      }
    }
  }
`;

const BOOKINGS_BY_RANGE_QUERY = `
  query Bookings(
    $where: BookingWhereInput
    $orderBy: [BookingOrderByWithRelationInput!]
    $take: Int
    $clinicMembersWhere2: ClinicMemberWhereInput
  ) {
    bookings(where: $where, orderBy: $orderBy, take: $take) {
      id
      status
      from_time
      to_time
      service_id
      member_id
      practitioner_id
      metadata
      service {
        id
        name
      }
      member {
        id
        name
        phonenumber
        clinic_members(where: $clinicMembersWhere2) {
          name
          phonenumber
          member_id
        }
      }
      practitioner {
        id
        name
      }
    }
  }
`;

const NEW_SALE_MUTATION = `
  mutation NewSale(
    $clinicId: String!
    $memberId: String!
    $userId: String!
    $netTotal: Float!
    $tax: Float!
    $discount: Float!
    $total: Float!
    $lineItems: [NewSaleLineItemInput!]!
    $paymentMethod: PaymentMethod!
    $orderNumber: String
    $paymentStatus: PaymentStatus
    $balance: Float
    $creditBalance: Float
    $sellerId: String
    $metadata: String
  ) {
    newSale(
      clinic_id: $clinicId
      member_id: $memberId
      user_id: $userId
      net_total: $netTotal
      tax: $tax
      discount: $discount
      total: $total
      line_items: $lineItems
      payment_method: $paymentMethod
      order_number: $orderNumber
      payment_status: $paymentStatus
      balance: $balance
      credit_balance: $creditBalance
      seller_id: $sellerId
      metadata: $metadata
    ) {
      id
      order_id
      payment_status
    }
  }
`;

const toNumber = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const mapClinic = (row: Record<string, unknown> | null | undefined): GTClinic | null => {
  if (!row?.id) {
    return null;
  }

  return {
    id: String(row.id),
    name: String(row.name ?? "Unnamed clinic").trim() || "Unnamed clinic",
    code: String(row.code ?? "").trim() || null,
    currency: String(row.currency ?? "").trim() || null,
    address: String(row.address ?? "").trim() || null,
    phoneNumber: String(row.phonenumber ?? "").trim() || null,
  };
};

const mapService = (row: Record<string, unknown>): GTService => ({
  id: String(row.id),
  name: String(row.name ?? "Unnamed service").trim() || "Unnamed service",
  description: String(row.description ?? "").trim() || null,
  metadata: String(row.metadata ?? "").trim() || null,
  durationMinutes: toNumber(row.duration),
  maxDurationCount: row.max_duration_count != null ? toNumber(row.max_duration_count) : null,
  intervalDay: row.interval_day != null ? toNumber(row.interval_day) : null,
  price: toNumber(row.price),
  originalPrice: toNumber(row.original_price),
  status: String(row.status ?? "UNKNOWN"),
});

const mapProduct = (row: Record<string, unknown>): GTProduct => {
  const stockRow = Array.isArray(row.product_stock_item) ? row.product_stock_item[0] : null;
  const stockItem =
    stockRow && typeof stockRow === "object"
      ? {
          id: String((stockRow as Record<string, unknown>).id),
          name:
            String((stockRow as Record<string, unknown>).name ?? "Unnamed stock item").trim() || "Unnamed stock item",
          stock: toNumber((stockRow as Record<string, unknown>).stock),
          price: toNumber((stockRow as Record<string, unknown>).price),
          originalPrice: toNumber((stockRow as Record<string, unknown>).original_price),
          status: String((stockRow as Record<string, unknown>).status ?? "UNKNOWN"),
          stockControlUnit: Boolean((stockRow as Record<string, unknown>).stock_control_unit),
          serviceStock:
            (stockRow as Record<string, unknown>).service_stock != null
              ? toNumber((stockRow as Record<string, unknown>).service_stock)
              : null,
          barcode: String((stockRow as Record<string, unknown>).barcode ?? "").trim() || null,
          sku: String((stockRow as Record<string, unknown>).sku ?? "").trim() || null,
        }
      : null;

  return {
    id: String(row.id),
    name: String(row.name ?? "Unnamed product").trim() || "Unnamed product",
    status: String(row.status ?? "UNKNOWN"),
    description: String(row.description ?? "").trim() || null,
    stockItem,
  };
};

const mapPractitioner = (row: Record<string, unknown>): GTPractitioner => ({
  id: String(row.id),
  name: String(row.name ?? "Unnamed practitioner").trim() || "Unnamed practitioner",
  status: String(row.status ?? "UNKNOWN"),
  phoneNumber: String(row.phonenumber ?? "").trim() || null,
  sex: String(row.sex ?? "").trim() || null,
  imageUrl: String(row.image ?? "").trim() || null,
  metadata: String(row.metadata ?? "").trim() || null,
});

const mapMember = (row: Record<string, unknown>): GTMember => ({
  id: String(row.id),
  name: String(row.name ?? "Unnamed member").trim() || "Unnamed member",
  phoneNumber: String(row.phonenumber ?? "").trim() || null,
  memberCode: String(row.member_id ?? "").trim() || null,
  metadata: String(row.metadata ?? "").trim() || null,
  note: String(row.note ?? "").trim() || null,
});

const mapBookingSummary = (row: Record<string, unknown>): GTBookingSummary => ({
  id: String(row.id),
  status: String(row.status ?? "UNKNOWN"),
  serviceId: String(row.service_id),
  serviceName:
    row.service && typeof row.service === "object"
      ? String((row.service as Record<string, unknown>).name ?? "").trim() || null
      : null,
  memberId: String(row.member_id),
  memberName:
    row.member && typeof row.member === "object"
      ? String((row.member as Record<string, unknown>).name ?? "").trim() || null
      : null,
  practitionerId: String(row.practitioner_id),
  practitionerName:
    row.practitioner && typeof row.practitioner === "object"
      ? String((row.practitioner as Record<string, unknown>).name ?? "").trim() || null
      : null,
  fromTime: String(row.from_time),
  toTime: String(row.to_time),
  metadata: String(row.metadata ?? "").trim() || null,
});

export class GTApiCoreAdapter {
  private async refreshAccessToken(session: GTSessionContext): Promise<void> {
    if (!session.refreshToken) {
      throw new AppError("GT refresh token is missing for this request.", {
        statusCode: 401,
        code: "missing_refresh_token",
      });
    }

    const payload = await this.rawRequest<GTAuthRefreshResult>({
      query: GT_AUTH_REFRESH,
      variables: {
        refreshToken: session.refreshToken,
      },
      accessToken: null,
      requestId: session.requestId,
    });

    if (!payload.gtAuthRefresh?.accessToken) {
      throw new AppError("gtAuthRefresh did not return a new access token.", {
        statusCode: 401,
        code: "refresh_failed",
      });
    }

    session.accessToken = payload.gtAuthRefresh.accessToken;
    session.refreshToken = payload.gtAuthRefresh.refreshToken ?? session.refreshToken;
  }

  private async rawRequest<TData>(params: {
    query: string;
    variables?: Record<string, unknown>;
    accessToken: string | null;
    requestId: string;
  }): Promise<TData> {
    const response = await fetch(config.gtApiCoreUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(params.accessToken ? { Authorization: `Bearer ${params.accessToken}` } : {}),
      },
      body: JSON.stringify({
        query: params.query,
        variables: params.variables ?? {},
      }),
    });

    const payload = (await response.json()) as GraphqlPayload<TData>;
    if (payload.errors?.length) {
      const first = payload.errors[0];
      const code = String(first.extensions?.code ?? "").toLowerCase();
      const unauthorized = code === "unauthorized" || String(first.message ?? "").toLowerCase().includes("access forbidden");
      throw new AppError(first.message ?? "GraphQL request failed.", {
        statusCode: unauthorized ? 401 : response.status || 502,
        code: unauthorized ? "gt_unauthorized" : "gt_graphql_error",
        details: {
          responseStatus: response.status,
          errors: payload.errors,
        },
      });
    }

    if (!payload.data) {
      throw new AppError("GraphQL request returned no data.", {
        statusCode: response.status || 502,
        code: "gt_empty_response",
      });
    }

    return payload.data;
  }

  async query<TData>(
    session: GTSessionContext,
    query: string,
    variables?: Record<string, unknown>,
    options?: { retryOnUnauthorized?: boolean },
  ): Promise<TData> {
    try {
      return await this.rawRequest<TData>({
        query,
        variables,
        accessToken: session.accessToken,
        requestId: session.requestId,
      });
    } catch (error) {
      const shouldRetry =
        (options?.retryOnUnauthorized ?? true) &&
        error instanceof AppError &&
        error.code === "gt_unauthorized" &&
        Boolean(session.refreshToken);

      if (!shouldRetry) {
        throw error;
      }

      logger.warn("GT request returned unauthorized; attempting refresh", {
        requestId: session.requestId,
        clinicId: session.clinicId,
        userId: session.userId,
      });
      await this.refreshAccessToken(session);

      return this.query<TData>(session, query, variables, { retryOnUnauthorized: false });
    }
  }

  async getClinic(session: GTSessionContext): Promise<GTClinic> {
    const result = await this.query<{ clinic: Record<string, unknown> | null }>(session, CLINIC_QUERY, {
      where: {
        id: session.clinicId,
      },
    });

    const clinic = mapClinic(result.clinic);
    if (!clinic) {
      throw new AppError(`Clinic ${session.clinicId} was not found.`, {
        statusCode: 404,
        code: "clinic_not_found",
      });
    }

    return clinic;
  }

  async getServices(session: GTSessionContext): Promise<GTService[]> {
    const result = await this.query<{ services: Array<Record<string, unknown>> }>(session, SERVICES_QUERY, {
      where: {
        clinic_id: { equals: session.clinicId },
        status: { in: ["ACTIVE", "INACTIVE", "CANCEL"] },
      },
    });

    return (result.services ?? []).map((row) => mapService(row));
  }

  async getProducts(session: GTSessionContext): Promise<GTProduct[]> {
    const result = await this.query<{ products: Array<Record<string, unknown>> }>(session, PRODUCTS_QUERY, {
      where: {
        clinic_id: { equals: session.clinicId },
        status: { in: ["ACTIVE"] },
      },
      take: 300,
    });

    return (result.products ?? []).map((row) => mapProduct(row));
  }

  async getPractitioners(session: GTSessionContext): Promise<GTPractitioner[]> {
    const result = await this.query<{ practitioners: Array<Record<string, unknown>> }>(session, PRACTITIONERS_QUERY, {
      where: {
        clinic_id: { equals: session.clinicId },
        status: { in: ["ACTIVE", "INACTIVE", "CANCEL"] },
      },
    });

    return (result.practitioners ?? []).map((row) => mapPractitioner(row));
  }

  async searchMembers(session: GTSessionContext, search: string): Promise<GTMember[]> {
    const result = await this.query<{ getMembers: Array<Record<string, unknown>> }>(session, MEMBERS_QUERY, {
      clinicId: session.clinicId,
      search,
      version: "v2",
    });

    return (result.getMembers ?? []).map((row) => mapMember(row));
  }

  async listClinicMembers(session: GTSessionContext, take = 200): Promise<GTMember[]> {
    const result = await this.query<{ members: Array<Record<string, unknown>> }>(session, CLINIC_MEMBER_REFERENCE_QUERY, {
      where: {
        clinics: {
          some: {
            id: { equals: session.clinicId },
          },
        },
      },
      clinicMembersWhere2: {
        clinic_id: { equals: session.clinicId },
      },
      orderBy: [{ created_at: "desc" }],
      take,
    });

    return (result.members ?? []).map((row) => {
      const clinicMember =
        Array.isArray(row.clinic_members) && row.clinic_members.length > 0
          ? (row.clinic_members[0] as Record<string, unknown>)
          : null;

      return {
        id: String(row.id),
        name: String(clinicMember?.name ?? row.name ?? "Unnamed member").trim() || "Unnamed member",
        phoneNumber: String(clinicMember?.phonenumber ?? row.phonenumber ?? "").trim() || null,
        memberCode: String(clinicMember?.member_id ?? row.member_id ?? "").trim() || null,
        metadata: String(clinicMember?.metadata ?? row.metadata ?? "").trim() || null,
        note: String(clinicMember?.note ?? row.note ?? "").trim() || null,
      };
    });
  }

  async getMemberById(session: GTSessionContext, memberId: string): Promise<GTMember | null> {
    const result = await this.query<{ member: Record<string, unknown> | null }>(session, MEMBER_BY_ID_QUERY, {
      where: { id: memberId },
      clinicMembersWhere2: {
        clinic_id: { equals: session.clinicId },
      },
    });

    if (!result.member) {
      return null;
    }

    const member = result.member;
    const clinicMember =
      Array.isArray(member.clinic_members) && member.clinic_members.length > 0
        ? (member.clinic_members[0] as Record<string, unknown>)
        : null;

    return {
      id: String(member.id),
      name: String(clinicMember?.name ?? member.name ?? "Unnamed member").trim() || "Unnamed member",
      phoneNumber: String(clinicMember?.phonenumber ?? member.phonenumber ?? "").trim() || null,
      memberCode: String(clinicMember?.member_id ?? member.member_id ?? "").trim() || null,
      metadata: String(clinicMember?.metadata ?? member.metadata ?? "").trim() || null,
      note: String(clinicMember?.note ?? member.note ?? "").trim() || null,
    };
  }

  async getServicePractitioners(
    session: GTSessionContext,
    serviceId: string,
    fromTime?: string,
    toTime?: string,
  ): Promise<GTPractitioner[]> {
    const result = await this.query<{ getServicePractioners: Array<Record<string, unknown>> }>(
      session,
      SERVICE_PRACTITIONERS_QUERY,
      {
        serviceId,
        fromTime: fromTime ?? null,
        toTime: toTime ?? null,
      },
    );

    return (result.getServicePractioners ?? []).map((row) => mapPractitioner(row));
  }

  async getServiceProductLinks(session: GTSessionContext): Promise<GTServiceProductLink[]> {
    const [itemsResult, usagesResult] = await Promise.all([
      this.query<{ serviceProductStockItems: Array<Record<string, unknown>> }>(session, SERVICE_PRODUCT_ITEMS_QUERY, {
        where: {
          product_stock_item: {
            is: {
              clinic_id: { equals: session.clinicId },
            },
          },
        },
        take: 400,
      }),
      this.query<{ serviceProductStockItemUsages: Array<Record<string, unknown>> }>(
        session,
        SERVICE_PRODUCT_USAGES_QUERY,
        {
          where: {
            service: {
              is: {
                clinic_id: { equals: session.clinicId },
              },
            },
          },
          take: 400,
        },
      ),
    ]);

    const itemMap = Object.fromEntries(
      (itemsResult.serviceProductStockItems ?? []).map((item) => [String(item.id), item]),
    );

    return (usagesResult.serviceProductStockItemUsages ?? []).reduce<GTServiceProductLink[]>((acc, usage) => {
      const service = usage.service as Record<string, unknown> | undefined;
      const psi = usage.service_product_stock_item as Record<string, unknown> | undefined;
      const item = itemMap[String(usage.service_product_stock_item_id ?? psi?.id ?? "")];
      const productStock =
        psi?.product_stock_item && typeof psi.product_stock_item === "object"
          ? (psi.product_stock_item as Record<string, unknown>)
          : item?.product_stock_item && typeof item.product_stock_item === "object"
            ? (item.product_stock_item as Record<string, unknown>)
            : null;

      if (!service?.id || !psi?.id || !productStock?.id) {
        return acc;
      }

      acc.push({
        id: String(usage.id),
        serviceId: String(service.id),
        serviceName: String(service.name ?? "Unnamed service").trim() || "Unnamed service",
        serviceProductStockItemId: String(psi.id),
        serviceProductStockItemName: String(psi.name ?? "Unnamed service stock").trim() || "Unnamed service stock",
        productStockItemId: String(productStock.id),
        productName: String(productStock.name ?? "Unnamed product").trim() || "Unnamed product",
        amountPerService: usage.amount_per_service != null ? toNumber(usage.amount_per_service) : null,
        amountPerProduct: item?.amount_per_product != null ? toNumber(item.amount_per_product) : null,
        productPrice: productStock.price != null ? toNumber(productStock.price) : null,
        productStock: productStock.stock != null ? toNumber(productStock.stock) : null,
      });
      return acc;
    }, []);
  }

  async getBookingById(session: GTSessionContext, bookingId: string): Promise<GTBookingSummary | null> {
    const result = await this.query<{ booking: Record<string, unknown> | null }>(session, BOOKING_BY_ID_QUERY, {
      where: {
        id: bookingId,
      },
    });

    return result.booking ? mapBookingSummary(result.booking) : null;
  }

  async getBookingsByRange(session: GTSessionContext, period: { fromDate: string; toDate: string; take?: number }) {
    const result = await this.query<{ bookings: Array<Record<string, unknown>> }>(session, BOOKINGS_BY_RANGE_QUERY, {
      where: {
        clinic_id: { equals: session.clinicId },
        from_time: {
          gte: period.fromDate,
          lte: period.toDate,
        },
      },
      clinicMembersWhere2: {
        clinic_id: { equals: session.clinicId },
      },
      orderBy: [{ from_time: "asc" }],
      take: period.take ?? 100,
    });

    return (result.bookings ?? []).map((row) => mapBookingSummary(row));
  }

  async createBooking(session: GTSessionContext, payload: GTBookingMutationPayload): Promise<GTBookingSummary> {
    const result = await this.query<{ createNewBooking: Record<string, unknown> }>(session, CREATE_BOOKING_MUTATION, {
      clinicId: payload.clinicId,
      serviceId: payload.serviceId,
      memberId: payload.memberId,
      practitionerId: payload.practitionerId,
      date: payload.scheduledAt,
      userId: payload.userId,
      status: "BOOKED",
      note: payload.note ?? null,
      serviceRoomId: payload.serviceRoomId ?? null,
      serviceHelperId: payload.serviceHelperId ?? null,
      channel: "DIRECT",
      duration: payload.durationMinutes,
      checkPractitionerAvailability: payload.checkPractitionerAvailability ?? true,
      metadata: payload.metadata ?? null,
    });

    return mapBookingSummary(result.createNewBooking);
  }

  async updateBooking(session: GTSessionContext, payload: GTBookingUpdatePayload): Promise<GTBookingSummary> {
    const data: Record<string, unknown> = {};

    if (payload.status) data.status = { set: payload.status };
    if (payload.fromTime) data.from_time = { set: payload.fromTime };
    if (payload.toTime) data.to_time = { set: payload.toTime };
    if (payload.metadata) data.metadata = { set: payload.metadata };
    if (payload.practitionerId) data.practitioner = { connect: { id: payload.practitionerId } };
    if (payload.serviceId) data.service = { connect: { id: payload.serviceId } };

    const result = await this.query<{ updateOneBooking: Record<string, unknown> }>(session, UPDATE_BOOKING_MUTATION, {
      where: { id: payload.bookingId },
      data,
    });

    return mapBookingSummary(result.updateOneBooking);
  }

  async cancelBooking(session: GTSessionContext, bookingId: string): Promise<GTBookingSummary> {
    return this.updateBooking(session, {
      bookingId,
      status: "MERCHANT_CANCEL",
    });
  }

  async createSale(session: GTSessionContext, payload: GTSaleMutationPayload): Promise<GTSaleExecutionResult> {
    const subtotal = payload.lineItems.reduce((sum, item) => sum + item.total, 0);
    const paidAmount = payload.paymentStatus === "PAID" ? subtotal : 0;
    const result = await this.query<{ newSale: Record<string, unknown> }>(session, NEW_SALE_MUTATION, {
      clinicId: payload.clinicId,
      memberId: payload.memberId,
      userId: payload.userId,
      netTotal: subtotal,
      tax: 0,
      discount: 0,
      total: subtotal,
      lineItems: payload.lineItems.map((item) => ({
        id: item.refId,
        quantity: item.quantity,
        price: item.unitPrice,
        total: item.total,
        tax: 0,
        original_price: item.unitPrice,
        type: item.refType,
        metadata: item.metadata ?? null,
        practitioner_id: item.practitionerId ?? null,
      })),
      paymentMethod: payload.paymentMethod,
      orderNumber: payload.orderNumber ?? null,
      paymentStatus: payload.paymentStatus,
      balance: paidAmount,
      creditBalance: Math.max(subtotal - paidAmount, 0),
      sellerId: payload.sellerId ?? null,
      metadata: payload.note ?? null,
    });

    return {
      id: String(result.newSale.id),
      orderId: String(result.newSale.order_id ?? "").trim() || null,
      paymentStatus: String(result.newSale.payment_status ?? "").trim() || null,
    };
  }
}
