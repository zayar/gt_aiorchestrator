import type { GTSessionContext } from "../types/session.js";
import { GTApiCoreAdapter } from "./GTApiCoreAdapter.js";

type BookingReportsResponse = {
  getBookingReports: {
    serviceBookings?: Array<{
      serviceName: string;
      month: string;
      bookingCount: number;
    }> | null;
    monthlyTotals?: Array<{
      month: string;
      totalBookings: number;
    }> | null;
    practitionerServices?: Array<{
      practitionerName: string;
      serviceName: string;
      bookingCount: number;
    }> | null;
  } | null;
};

type SaleReportResponse = {
  saleReport: {
    data: Array<{
      seller_name?: string | null;
      services?: string | null;
      payment_amount?: number | null;
      customer_name?: string | null;
      practitioner?: string | null;
      visit_date?: string | null;
    }>;
    total: number;
  } | null;
};

type SaleGroupReportResponse = {
  saleGroupReport: {
    data: Array<{
      seller_name?: string | null;
      payment_amount?: number | null;
      customer_name?: string | null;
    }>;
    total: number;
  } | null;
};

const GET_BOOKING_REPORTS = `
  query GetBookingReports(
    $queryType: BookingReportType!
    $clinicCode: String!
    $fromDate: String
    $toDate: String
    $take: Int!
    $skip: Int!
  ) {
    getBookingReports(
      queryType: $queryType
      clinicCode: $clinicCode
      fromDate: $fromDate
      toDate: $toDate
      take: $take
      skip: $skip
    ) {
      serviceBookings {
        serviceName
        month
        bookingCount
      }
      monthlyTotals {
        month
        totalBookings
      }
      practitionerServices {
        practitionerName
        serviceName
        bookingCount
      }
    }
  }
`;

const SALE_REPORT = `
  query SaleReport(
    $clinic_code: String!
    $from_date: DateTime!
    $to_date: DateTime!
    $take: Int!
    $skip: Int!
  ) {
    saleReport(
      clinic_code: $clinic_code
      from_date: $from_date
      to_date: $to_date
      take: $take
      skip: $skip
    ) {
      data {
        seller_name
        services
        payment_amount
        customer_name
        practitioner
        visit_date
      }
      total
    }
  }
`;

const SALE_GROUP_REPORT = `
  query SaleGroupReport(
    $clinic_code: String!
    $from_date: DateTime!
    $to_date: DateTime!
    $report_type: ReportType!
    $take: Int!
    $skip: Int!
  ) {
    saleGroupReport(
      clinic_code: $clinic_code
      from_date: $from_date
      to_date: $to_date
      report_type: $report_type
      take: $take
      skip: $skip
    ) {
      data {
        seller_name
        payment_amount
        customer_name
      }
      total
    }
  }
`;

export class GTReportAdapter {
  constructor(private readonly apiCoreAdapter: GTApiCoreAdapter) {}

  async getBookingReports(
    session: GTSessionContext,
    params: {
      clinicCode: string;
      queryType: "SERVICE_BOOKINGS" | "MONTHLY_TOTALS" | "PRACTITIONER_SERVICES";
      fromDate?: string;
      toDate?: string;
      take?: number;
      skip?: number;
    },
  ) {
    const result = await this.apiCoreAdapter.query<BookingReportsResponse>(session, GET_BOOKING_REPORTS, {
      queryType: params.queryType,
      clinicCode: params.clinicCode,
      fromDate: params.fromDate ?? null,
      toDate: params.toDate ?? null,
      take: params.take ?? 50,
      skip: params.skip ?? 0,
    });

    return result.getBookingReports;
  }

  async getSalesReport(
    session: GTSessionContext,
    params: {
      clinicCode: string;
      fromDate: string;
      toDate: string;
      take?: number;
      skip?: number;
    },
  ) {
    const result = await this.apiCoreAdapter.query<SaleReportResponse>(session, SALE_REPORT, {
      clinic_code: params.clinicCode,
      from_date: params.fromDate,
      to_date: params.toDate,
      take: params.take ?? 100,
      skip: params.skip ?? 0,
    });

    return result.saleReport;
  }

  async getSalesBySalesperson(
    session: GTSessionContext,
    params: {
      clinicCode: string;
      fromDate: string;
      toDate: string;
      take?: number;
      skip?: number;
    },
  ) {
    const result = await this.apiCoreAdapter.query<SaleGroupReportResponse>(session, SALE_GROUP_REPORT, {
      clinic_code: params.clinicCode,
      from_date: params.fromDate,
      to_date: params.toDate,
      report_type: "SALE_BY_SALESPERSON",
      take: params.take ?? 100,
      skip: params.skip ?? 0,
    });

    return result.saleGroupReport;
  }
}
