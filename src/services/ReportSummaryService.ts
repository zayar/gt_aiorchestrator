import { GTReportAdapter } from "../adapters/GTReportAdapter.js";
import { GTApiCoreAdapter } from "../adapters/GTApiCoreAdapter.js";
import type { AnalyzeAssistantResponse, AssistantWarning } from "../types/contracts.js";
import type { GTSessionContext } from "../types/session.js";
import { inferReportPeriod } from "../utils/time.js";

export class ReportSummaryService {
  constructor(
    private readonly apiCoreAdapter: GTApiCoreAdapter,
    private readonly reportAdapter: GTReportAdapter,
  ) {}

  async analyze(params: {
    requestId: string;
    transcript: string;
    intent: "report.booking_summary" | "report.sales_summary" | "report.practitioner_summary";
    session: GTSessionContext;
  }): Promise<AnalyzeAssistantResponse> {
    const period = inferReportPeriod(params.transcript, new Date(), params.session.timezone);
    const clinic = await this.apiCoreAdapter.getClinic(params.session);
    const clinicCode = clinic.code ?? clinic.id;
    const warnings: AssistantWarning[] = [];

    if (params.intent === "report.booking_summary") {
      const bookings = await this.apiCoreAdapter.getBookingsByRange(params.session, {
        fromDate: period.fromDate,
        toDate: period.toDate,
      });
      const byService = Object.entries(
        bookings.reduce<Record<string, number>>((acc, booking) => {
          const key = booking.serviceName ?? booking.serviceId;
          acc[key] = (acc[key] ?? 0) + 1;
          return acc;
        }, {}),
      )
        .sort((left, right) => right[1] - left[1])
        .slice(0, 5);

      return {
        requestId: params.requestId,
        transcript: params.transcript,
        intent: params.intent,
        confidence: 0.95,
        needsClarification: false,
        missingFields: [],
        candidateOptions: [],
        resolvedEntities: {},
        recommendedProducts: [],
        warnings,
        confirmRequired: false,
        summary: `Found ${bookings.length} bookings for ${period.label}.`,
        proposedAction: {
          actionId: `${params.requestId}:report:booking`,
          intent: params.intent,
          confirmRequired: false,
          summary: `Booking summary for ${period.label}`,
          report: {
            title: "Booking Summary",
            period,
            highlights: [
              `Total bookings: ${bookings.length}`,
              ...byService.map(([serviceName, count]) => `${serviceName}: ${count}`),
            ],
            metrics: [
              { label: "Total bookings", value: bookings.length },
            ],
            rows: bookings.slice(0, 20).map((booking) => ({
              bookingId: booking.id,
              service: booking.serviceName ?? booking.serviceId,
              member: booking.memberName ?? booking.memberId,
              practitioner: booking.practitionerName ?? booking.practitionerId,
              status: booking.status,
              fromTime: booking.fromTime,
            })),
          },
        },
      };
    }

    if (params.intent === "report.sales_summary") {
      const [salesReport, salespersonSummary] = await Promise.all([
        this.reportAdapter.getSalesReport(params.session, {
          clinicCode,
          fromDate: period.fromDate,
          toDate: period.toDate,
        }),
        this.reportAdapter.getSalesBySalesperson(params.session, {
          clinicCode,
          fromDate: period.fromDate,
          toDate: period.toDate,
        }),
      ]);

      const totalSales = (salesReport?.data ?? []).reduce((sum, row) => sum + Number(row.payment_amount ?? 0), 0);
      const topSeller = (salespersonSummary?.data ?? []).slice().sort((left, right) =>
        Number(right.payment_amount ?? 0) - Number(left.payment_amount ?? 0),
      )[0];

      return {
        requestId: params.requestId,
        transcript: params.transcript,
        intent: params.intent,
        confidence: 0.94,
        needsClarification: false,
        missingFields: [],
        candidateOptions: [],
        resolvedEntities: {},
        recommendedProducts: [],
        warnings,
        confirmRequired: false,
        summary: `Sales summary ready for ${period.label}.`,
        proposedAction: {
          actionId: `${params.requestId}:report:sales`,
          intent: params.intent,
          confirmRequired: false,
          summary: `Sales summary for ${period.label}`,
          report: {
            title: "Sales Summary",
            period,
            highlights: [
              `Total sales amount: ${totalSales}`,
              topSeller
                ? `Top seller: ${topSeller.seller_name ?? "Unknown"} (${Number(topSeller.payment_amount ?? 0)})`
                : "No seller data returned for this period",
            ],
            metrics: [
              { label: "Sales amount", value: totalSales },
              { label: "Transactions", value: salesReport?.total ?? 0 },
            ],
            rows: (salespersonSummary?.data ?? []).map((row) => ({
              seller: row.seller_name ?? "Unknown",
              paymentAmount: Number(row.payment_amount ?? 0),
            })),
          },
        },
      };
    }

    const practitionerSummary = await this.reportAdapter.getBookingReports(params.session, {
      clinicCode,
      queryType: "PRACTITIONER_SERVICES",
      fromDate: period.fromDate.slice(0, 10),
      toDate: period.toDate.slice(0, 10),
    });

    return {
      requestId: params.requestId,
      transcript: params.transcript,
      intent: params.intent,
      confidence: 0.92,
      needsClarification: false,
      missingFields: [],
      candidateOptions: [],
      resolvedEntities: {},
      recommendedProducts: [],
      warnings,
      confirmRequired: false,
      summary: `Practitioner summary ready for ${period.label}.`,
      proposedAction: {
        actionId: `${params.requestId}:report:practitioner`,
        intent: params.intent,
        confirmRequired: false,
        summary: `Practitioner summary for ${period.label}`,
        report: {
          title: "Practitioner Summary",
          period,
          highlights: (practitionerSummary?.practitionerServices ?? [])
            .slice(0, 5)
            .map((row) => `${row.practitionerName}: ${row.serviceName} (${row.bookingCount})`),
          metrics: [
            {
              label: "Practitioner-service rows",
              value: practitionerSummary?.practitionerServices?.length ?? 0,
            },
          ],
          rows: (practitionerSummary?.practitionerServices ?? []).map((row) => ({
            practitioner: row.practitionerName,
            service: row.serviceName,
            bookingCount: row.bookingCount,
          })),
        },
      },
    };
  }
}
