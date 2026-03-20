import type { AssistantIntent } from "../types/contracts.js";

export const supportedAssistantIntents: AssistantIntent[] = [
  "booking.create",
  "booking.reschedule",
  "booking.cancel",
  "booking.availability_check",
  "sale.create",
  "sale.quote",
  "inventory.check",
  "recommend.products_for_service",
  "report.booking_summary",
  "report.sales_summary",
  "report.practitioner_summary",
  "unknown",
];
