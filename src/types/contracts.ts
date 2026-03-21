import type {
  GTBookingMutationPayload,
  GTBookingSummary,
  GTCatalogSnapshot,
  GTMember,
  GTPractitioner,
  GTProduct,
  GTReportPeriod,
  GTSaleDraftLineItem,
  GTSaleExecutionResult,
  GTService,
} from "./domain.js";

export type AssistantIntent =
  | "booking.create"
  | "booking.reschedule"
  | "booking.cancel"
  | "booking.availability_check"
  | "sale.create"
  | "sale.quote"
  | "inventory.check"
  | "recommend.products_for_service"
  | "report.booking_summary"
  | "report.sales_summary"
  | "report.practitioner_summary"
  | "unknown";

export type ClarificationType =
  | "missing_field"
  | "ambiguous_entity"
  | "unavailable_slot"
  | "out_of_stock"
  | "unsupported";

export type MissingFieldKey =
  | "member"
  | "service"
  | "product"
  | "practitioner"
  | "date"
  | "time"
  | "booking_reference"
  | "line_items"
  | "seller";

export type CandidateOptionType =
  | "member"
  | "service"
  | "product"
  | "practitioner"
  | "time_slot"
  | "booking";

export type ExecutionStatus =
  | "executed"
  | "duplicate"
  | "rejected"
  | "failed"
  | "needs_clarification";

export type AssistantWarning = {
  code: string;
  message: string;
};

export type AudioInput = {
  base64?: string;
  mimeType?: string;
  url?: string;
};

export type AssistantUserContext = {
  userId?: string;
  displayName?: string;
  role?: string;
};

export type AnalyzeAssistantRequest = {
  requestId: string;
  clinicId?: string;
  transcript?: string;
  audio?: AudioInput;
  locale?: string;
  language?: string;
  timezone?: string;
  userContext?: AssistantUserContext;
  selectedOptionIds?: string[];
  metadata?: Record<string, unknown>;
};

export type CandidateOption = {
  id: string;
  type: CandidateOptionType;
  label: string;
  subtitle?: string;
  confidence?: number;
  metadata?: Record<string, unknown>;
};

export type ClarificationPayload = {
  type: ClarificationType;
  message: string;
  missingFields: MissingFieldKey[];
  options: CandidateOption[];
};

export type ResolvedEntity<TEntity> = {
  id: string;
  name: string;
  confidence: number;
  entity: TEntity;
};

export type ResolvedTimeSlot = {
  startAt: string;
  endAt?: string;
  label: string;
  confidence: number;
};

export type AssistantEntitySet = {
  member?: ResolvedEntity<GTMember>;
  service?: ResolvedEntity<GTService>;
  product?: ResolvedEntity<GTProduct>;
  practitioner?: ResolvedEntity<GTPractitioner>;
  booking?: {
    id: string;
    status: string;
  };
  requestedTime?: ResolvedTimeSlot;
  lineItems?: GTSaleDraftLineItem[];
  rawHints?: {
    memberName?: string;
    serviceName?: string;
    practitionerName?: string;
    productName?: string;
    bookingId?: string;
    timeText?: string;
  };
};

export type RecommendationPayload = {
  productId: string;
  productName: string;
  stockItemId?: string;
  stock?: number | null;
  price?: number | null;
  reason: string;
  source: "service_mapping" | "catalog_similarity";
};

export type BookingActionPreview = {
  operation: "create" | "reschedule" | "cancel" | "availability_check";
  clinicId: string;
  bookingId?: string;
  memberId?: string;
  memberName?: string;
  serviceId?: string;
  serviceName?: string;
  practitionerId?: string;
  practitionerName?: string;
  scheduledAt?: string;
  endAt?: string;
  durationMinutes?: number;
  note?: string;
  validationSummary?: string;
  payload?: GTBookingMutationPayload;
};

export type SaleActionPreview = {
  operation: "create" | "quote" | "inventory_check";
  clinicId: string;
  memberId?: string;
  memberName?: string;
  paymentMethod?: string;
  paymentStatus?: string;
  lineItems: GTSaleDraftLineItem[];
  subtotal: number;
  warnings: AssistantWarning[];
};

export type ReportSummaryPayload = {
  title: string;
  period: GTReportPeriod;
  highlights: string[];
  metrics: Array<{
    label: string;
    value: number | string;
  }>;
  rows: Array<Record<string, string | number | null>>;
};

export type ProposedActionPreview = {
  actionId: string;
  intent: AssistantIntent;
  confirmRequired: boolean;
  summary: string;
  booking?: BookingActionPreview;
  sale?: SaleActionPreview;
  report?: ReportSummaryPayload;
};

export type IntentResult = {
  intent: AssistantIntent;
  confidence: number;
  risky: boolean;
  rawHints: AssistantEntitySet["rawHints"];
};

export type AnalyzeAssistantResponse = {
  requestId: string;
  transcript: string;
  intent: AssistantIntent;
  confidence: number;
  needsClarification: boolean;
  clarificationType?: ClarificationType;
  missingFields: MissingFieldKey[];
  candidateOptions: CandidateOption[];
  clarification?: ClarificationPayload;
  resolvedEntities: AssistantEntitySet;
  proposedAction?: ProposedActionPreview;
  recommendedProducts: RecommendationPayload[];
  warnings: AssistantWarning[];
  summary: string;
  confirmRequired: boolean;
};

export type CatalogBootstrapResponse = {
  clinic: GTCatalogSnapshot["clinic"];
  services: GTService[];
  products: GTProduct[];
  practitioners: GTPractitioner[];
  members: GTMember[];
  serviceProductLinks: GTCatalogSnapshot["serviceProductLinks"];
  loadedAt: string;
  memberCount: number;
};

export type CatalogMembersResponse = {
  query: string;
  members: GTMember[];
  loadedAt: string;
};

export type ConfirmActionRequest = {
  requestId: string;
  confirmation: boolean;
  idempotencyKey: string;
  selectedOptionIds?: string[];
  updatedFields?: Record<string, unknown>;
  proposedAction?: ProposedActionPreview;
};

export type ExecutionResult = {
  booking?: GTBookingSummary | null;
  sale?: GTSaleExecutionResult | null;
  report?: ReportSummaryPayload | null;
};

export type ConfirmActionResponse = {
  requestId: string;
  executionStatus: ExecutionStatus;
  result?: ExecutionResult;
  summary: string;
  warnings: AssistantWarning[];
  errors?: string[];
  clarification?: ClarificationPayload;
};

export type PendingActionRecord = {
  requestId: string;
  transcript: string;
  intent: AssistantIntent;
  proposedAction: ProposedActionPreview;
  resolvedEntities: AssistantEntitySet;
  recommendedProducts: RecommendationPayload[];
  warnings: AssistantWarning[];
  createdAt: string;
};

export type CatalogCandidateSummary = Pick<GTCatalogSnapshot, "clinic">;
