import type {
  AnalyzeAssistantRequest,
  AnalyzeAssistantResponse,
  AssistantWarning,
  ConfirmActionResponse,
  PendingActionRecord,
} from "../types/contracts.js";
import type { GTSessionContext } from "../types/session.js";
import { GTApiCoreAdapter } from "../adapters/GTApiCoreAdapter.js";
import { GTCatalogService } from "./GTCatalogService.js";
import { EntityResolutionService } from "./EntityResolutionService.js";
import { RecommendationService } from "./RecommendationService.js";
import { ClarificationService } from "./ClarificationService.js";
import { buildEndTime, formatDateTimeLabel, parseDateTimeHint } from "../utils/time.js";

export class AppointmentOrchestrator {
  constructor(
    private readonly apiCoreAdapter: GTApiCoreAdapter,
    private readonly catalogService: GTCatalogService,
    private readonly entityResolutionService: EntityResolutionService,
    private readonly recommendationService: RecommendationService,
    private readonly clarificationService: ClarificationService,
  ) {}

  async analyze(params: {
    requestId: string;
    transcript: string;
    intent:
      | "booking.create"
      | "booking.reschedule"
      | "booking.cancel"
      | "booking.availability_check";
    request: AnalyzeAssistantRequest;
    session: GTSessionContext;
    rawHints: AnalyzeAssistantResponse["resolvedEntities"]["rawHints"];
  }): Promise<AnalyzeAssistantResponse> {
    const warnings: AssistantWarning[] = [];

    if (params.intent === "booking.cancel" || params.intent === "booking.reschedule") {
      const bookingId =
        String(params.rawHints?.bookingId ?? "").trim() ||
        String(params.request.metadata?.bookingId ?? "").trim();

      if (!bookingId) {
        const clarification = this.clarificationService.missingField(
          "Please choose which booking should be updated.",
          ["booking_reference"],
        );

        return {
          requestId: params.requestId,
          transcript: params.transcript,
          intent: params.intent,
          confidence: 0.82,
          needsClarification: true,
          clarificationType: clarification.type,
          missingFields: clarification.missingFields,
          candidateOptions: clarification.options,
          clarification,
          resolvedEntities: {
            rawHints: params.rawHints,
          },
          recommendedProducts: [],
          warnings,
          summary: clarification.message,
          confirmRequired: false,
        };
      }

      const booking = await this.apiCoreAdapter.getBookingById(params.session, bookingId);
      if (!booking) {
        const clarification = this.clarificationService.missingField(
          "That booking could not be found. Please choose a valid booking reference.",
          ["booking_reference"],
        );

        return {
          requestId: params.requestId,
          transcript: params.transcript,
          intent: params.intent,
          confidence: 0.72,
          needsClarification: true,
          clarificationType: clarification.type,
          missingFields: clarification.missingFields,
          candidateOptions: clarification.options,
          clarification,
          resolvedEntities: {
            booking: {
              id: bookingId,
              status: "UNKNOWN",
            },
            rawHints: params.rawHints,
          },
          recommendedProducts: [],
          warnings,
          summary: clarification.message,
          confirmRequired: false,
        };
      }

      if (params.intent === "booking.cancel") {
        return {
          requestId: params.requestId,
          transcript: params.transcript,
          intent: params.intent,
          confidence: 0.96,
          needsClarification: false,
          missingFields: [],
          candidateOptions: [],
          resolvedEntities: {
            booking: {
              id: booking.id,
              status: booking.status,
            },
            rawHints: params.rawHints,
          },
          recommendedProducts: [],
          warnings,
          summary: `Cancel booking ${booking.id} for ${booking.memberName ?? booking.memberId}?`,
          confirmRequired: true,
          proposedAction: {
            actionId: `${params.requestId}:booking:cancel`,
            intent: params.intent,
            confirmRequired: true,
            summary: `Cancel booking ${booking.id}`,
            booking: {
              operation: "cancel",
              clinicId: params.session.clinicId,
              bookingId: booking.id,
              memberId: booking.memberId,
              memberName: booking.memberName ?? undefined,
              serviceId: booking.serviceId,
              serviceName: booking.serviceName ?? undefined,
              practitionerId: booking.practitionerId,
              practitionerName: booking.practitionerName ?? undefined,
              scheduledAt: booking.fromTime,
              endAt: booking.toTime,
              validationSummary: `Current status ${booking.status}`,
            },
          },
        };
      }

      const timeHint = parseDateTimeHint(params.rawHints?.timeText ?? params.transcript, new Date(), params.session.timezone);
      if (!timeHint.startAt) {
        const clarification = this.clarificationService.missingField(
          "Please choose the new booking date and time.",
          [
            ...(timeHint.missingDate ? ["date"] as const : []),
            ...(timeHint.missingTime ? ["time"] as const : []),
          ],
        );

        return {
          requestId: params.requestId,
          transcript: params.transcript,
          intent: params.intent,
          confidence: 0.8,
          needsClarification: true,
          clarificationType: clarification.type,
          missingFields: clarification.missingFields,
          candidateOptions: clarification.options,
          clarification,
          resolvedEntities: {
            booking: {
              id: booking.id,
              status: booking.status,
            },
            rawHints: params.rawHints,
          },
          recommendedProducts: [],
          warnings,
          summary: clarification.message,
          confirmRequired: false,
        };
      }

      const endAt = buildEndTime(timeHint.startAt, 60);
      return {
        requestId: params.requestId,
        transcript: params.transcript,
        intent: params.intent,
        confidence: 0.9,
        needsClarification: false,
        missingFields: [],
        candidateOptions: [],
        resolvedEntities: {
          booking: {
            id: booking.id,
            status: booking.status,
          },
          requestedTime: {
            startAt: timeHint.startAt.toISOString(),
            endAt: endAt.toISOString(),
            label: formatDateTimeLabel(timeHint.startAt, params.session.timezone),
            confidence: timeHint.confidence,
          },
          rawHints: params.rawHints,
        },
        recommendedProducts: [],
        warnings,
        summary: `Move booking ${booking.id} to ${formatDateTimeLabel(timeHint.startAt, params.session.timezone)}?`,
        confirmRequired: true,
        proposedAction: {
          actionId: `${params.requestId}:booking:reschedule`,
          intent: params.intent,
          confirmRequired: true,
          summary: `Reschedule booking ${booking.id}`,
          booking: {
            operation: "reschedule",
            clinicId: params.session.clinicId,
            bookingId: booking.id,
            memberId: booking.memberId,
            memberName: booking.memberName ?? undefined,
            serviceId: booking.serviceId,
            serviceName: booking.serviceName ?? undefined,
            practitionerId: booking.practitionerId,
            practitionerName: booking.practitionerName ?? undefined,
            scheduledAt: timeHint.startAt.toISOString(),
            endAt: endAt.toISOString(),
            validationSummary: `Current status ${booking.status}`,
          },
        },
      };
    }

    const catalog = await this.catalogService.getCatalog(params.session);
    const serviceResolution = this.entityResolutionService.resolveService(
      params.rawHints?.serviceName ?? params.transcript,
      catalog,
      params.request.selectedOptionIds,
    );

    if (serviceResolution.state !== "resolved") {
      const clarification =
        serviceResolution.state === "ambiguous"
          ? this.clarificationService.ambiguousEntity(
              "Please choose the service.",
              serviceResolution.options,
              ["service"],
            )
          : this.clarificationService.missingField("Please choose the service.", ["service"], serviceResolution.options);

      return {
        requestId: params.requestId,
        transcript: params.transcript,
        intent: params.intent,
        confidence: 0.62,
        needsClarification: true,
        clarificationType: clarification.type,
        missingFields: clarification.missingFields,
        candidateOptions: clarification.options,
        clarification,
        resolvedEntities: {
          rawHints: params.rawHints,
        },
        recommendedProducts: [],
        warnings,
        summary: clarification.message,
        confirmRequired: false,
      };
    }

    const resolvedService = serviceResolution.resolved!;
    const service = resolvedService.entity;
    const recommendations = this.recommendationService.recommendProductsForService({
      service,
      catalog,
    });

    const timeHint = parseDateTimeHint(params.rawHints?.timeText ?? params.transcript, new Date(), params.session.timezone);
    if (!timeHint.startAt) {
      const clarification = this.clarificationService.missingField(
        "Please choose the appointment date and time.",
        [
          ...(timeHint.missingDate ? ["date"] as const : []),
          ...(timeHint.missingTime ? ["time"] as const : []),
        ],
      );

      return {
        requestId: params.requestId,
        transcript: params.transcript,
        intent: params.intent,
        confidence: 0.74,
        needsClarification: true,
        clarificationType: clarification.type,
        missingFields: clarification.missingFields,
        candidateOptions: clarification.options,
        clarification,
        resolvedEntities: {
          service: resolvedService,
          rawHints: params.rawHints,
        },
        recommendedProducts: recommendations,
        warnings,
        summary: clarification.message,
        confirmRequired: false,
      };
    }

    const endAt = buildEndTime(timeHint.startAt, service.durationMinutes || 60);
    const availablePractitioners = await this.apiCoreAdapter.getServicePractitioners(
      params.session,
      service.id,
      timeHint.startAt.toISOString(),
      endAt.toISOString(),
    );

    if (availablePractitioners.length === 0) {
      const clarification = this.clarificationService.unavailableSlot(
        `No practitioners are available for ${service.name} at ${formatDateTimeLabel(timeHint.startAt, params.session.timezone)}.`,
      );

      return {
        requestId: params.requestId,
        transcript: params.transcript,
        intent: params.intent,
        confidence: 0.8,
        needsClarification: true,
        clarificationType: clarification.type,
        missingFields: clarification.missingFields,
        candidateOptions: clarification.options,
        clarification,
        resolvedEntities: {
          service: resolvedService,
          requestedTime: {
            startAt: timeHint.startAt.toISOString(),
            endAt: endAt.toISOString(),
            label: formatDateTimeLabel(timeHint.startAt, params.session.timezone),
            confidence: timeHint.confidence,
          },
          rawHints: params.rawHints,
        },
        recommendedProducts: recommendations,
        warnings,
        summary: clarification.message,
        confirmRequired: false,
      };
    }

    const practitionerResolution = params.request.selectedOptionIds?.some((candidateId) =>
      availablePractitioners.some((practitioner) => practitioner.id === candidateId),
    )
      ? this.entityResolutionService.resolvePractitioner(
          params.rawHints?.practitionerName ?? params.transcript,
          availablePractitioners,
          params.request.selectedOptionIds,
        )
      : params.rawHints?.practitionerName
        ? this.entityResolutionService.resolvePractitioner(
            params.rawHints.practitionerName,
            availablePractitioners,
            params.request.selectedOptionIds,
          )
        : availablePractitioners.length === 1
          ? {
              state: "resolved" as const,
              resolved: {
                id: availablePractitioners[0].id,
                name: availablePractitioners[0].name,
                confidence: 0.95,
                entity: availablePractitioners[0],
              },
              options: [],
            }
          : {
              state: "missing" as const,
              options: availablePractitioners.slice(0, 5).map((practitioner) => ({
                id: practitioner.id,
                type: "practitioner" as const,
                label: practitioner.name,
              })),
            };

    if (practitionerResolution.state !== "resolved") {
      const clarification =
        practitionerResolution.state === "ambiguous"
          ? this.clarificationService.ambiguousEntity(
              "Please choose the practitioner.",
              practitionerResolution.options,
              ["practitioner"],
            )
          : this.clarificationService.missingField(
              "Please choose the practitioner.",
              ["practitioner"],
              practitionerResolution.options,
            );

      return {
        requestId: params.requestId,
        transcript: params.transcript,
        intent: params.intent,
        confidence: 0.78,
        needsClarification: true,
        clarificationType: clarification.type,
        missingFields: clarification.missingFields,
        candidateOptions: clarification.options,
        clarification,
        resolvedEntities: {
          service: resolvedService,
          requestedTime: {
            startAt: timeHint.startAt.toISOString(),
            endAt: endAt.toISOString(),
            label: formatDateTimeLabel(timeHint.startAt, params.session.timezone),
            confidence: timeHint.confidence,
          },
          rawHints: params.rawHints,
        },
        recommendedProducts: recommendations,
        warnings,
        summary: clarification.message,
        confirmRequired: false,
      };
    }

    const resolvedPractitioner = practitionerResolution.resolved!;
    if (params.intent === "booking.availability_check") {
      return {
        requestId: params.requestId,
        transcript: params.transcript,
        intent: params.intent,
        confidence: 0.93,
        needsClarification: false,
        missingFields: [],
        candidateOptions: [],
        resolvedEntities: {
          service: resolvedService,
          practitioner: resolvedPractitioner,
          requestedTime: {
            startAt: timeHint.startAt.toISOString(),
            endAt: endAt.toISOString(),
            label: formatDateTimeLabel(timeHint.startAt, params.session.timezone),
            confidence: timeHint.confidence,
          },
          rawHints: params.rawHints,
        },
        recommendedProducts: recommendations,
        warnings,
        summary: `${service.name} is available with ${resolvedPractitioner.name} at ${formatDateTimeLabel(timeHint.startAt, params.session.timezone)}.`,
        confirmRequired: false,
      };
    }

    const memberResolution = await this.entityResolutionService.resolveMember(
      params.session,
      params.rawHints?.memberName,
      params.request.selectedOptionIds,
    );
    const resolvedMember = memberResolution.resolved!;

    if (memberResolution.state !== "resolved") {
      const clarification =
        memberResolution.state === "ambiguous"
          ? this.clarificationService.ambiguousEntity("Please choose the member.", memberResolution.options, ["member"])
          : this.clarificationService.missingField("Please choose the member.", ["member"], memberResolution.options);

      return {
        requestId: params.requestId,
        transcript: params.transcript,
        intent: params.intent,
        confidence: 0.76,
        needsClarification: true,
        clarificationType: clarification.type,
        missingFields: clarification.missingFields,
        candidateOptions: clarification.options,
        clarification,
        resolvedEntities: {
          service: resolvedService,
          practitioner: resolvedPractitioner,
          requestedTime: {
            startAt: timeHint.startAt.toISOString(),
            endAt: endAt.toISOString(),
            label: formatDateTimeLabel(timeHint.startAt, params.session.timezone),
            confidence: timeHint.confidence,
          },
          rawHints: params.rawHints,
        },
        recommendedProducts: recommendations,
        warnings,
        summary: clarification.message,
        confirmRequired: false,
      };
    }

    const userId = params.session.userId;
    if (!userId) {
      warnings.push({
        code: "missing_user_id",
        message: "Token did not expose a user id. Booking execution will fail until that is provided.",
      });
    }

    return {
      requestId: params.requestId,
      transcript: params.transcript,
      intent: params.intent,
      confidence: 0.96,
      needsClarification: false,
      missingFields: userId ? [] : ["member"],
      candidateOptions: [],
      resolvedEntities: {
        member: resolvedMember,
        service: resolvedService,
        practitioner: resolvedPractitioner,
        requestedTime: {
          startAt: timeHint.startAt.toISOString(),
          endAt: endAt.toISOString(),
          label: formatDateTimeLabel(timeHint.startAt, params.session.timezone),
          confidence: timeHint.confidence,
        },
        rawHints: params.rawHints,
      },
      recommendedProducts: recommendations,
      warnings,
      summary: `Ready to book ${service.name} for ${resolvedMember.name} with ${resolvedPractitioner.name} at ${formatDateTimeLabel(timeHint.startAt, params.session.timezone)}.`,
      confirmRequired: true,
      proposedAction: {
        actionId: `${params.requestId}:booking:create`,
        intent: params.intent,
        confirmRequired: true,
        summary: `Book ${service.name} for ${resolvedMember.name}`,
        booking: {
          operation: "create",
          clinicId: params.session.clinicId,
          memberId: resolvedMember.id,
          memberName: resolvedMember.name,
          serviceId: service.id,
          serviceName: service.name,
          practitionerId: resolvedPractitioner.id,
          practitionerName: resolvedPractitioner.name,
          scheduledAt: timeHint.startAt.toISOString(),
          endAt: endAt.toISOString(),
          durationMinutes: service.durationMinutes || 60,
          validationSummary: "Validated against GreatTime service and practitioner availability query.",
          payload: userId
            ? {
                clinicId: params.session.clinicId,
                memberId: resolvedMember.id,
                serviceId: service.id,
                practitionerId: resolvedPractitioner.id,
                scheduledAt: timeHint.startAt.toISOString(),
                durationMinutes: service.durationMinutes || 60,
                userId,
                checkPractitionerAvailability: true,
                metadata: JSON.stringify({
                  source: "ai-orchestrator-gt",
                  requestId: params.requestId,
                }),
              }
            : undefined,
        },
      },
    };
  }

  async execute(params: {
    session: GTSessionContext;
    pendingAction: PendingActionRecord;
  }): Promise<ConfirmActionResponse> {
    const bookingPreview = params.pendingAction.proposedAction.booking;
    if (!bookingPreview) {
      return {
        requestId: params.pendingAction.requestId,
        executionStatus: "failed",
        summary: "Booking preview was not available for execution.",
        warnings: [],
        errors: ["missing_booking_preview"],
      };
    }

    if (bookingPreview.operation === "create") {
      if (!bookingPreview.payload) {
        return {
          requestId: params.pendingAction.requestId,
          executionStatus: "failed",
          summary: "Booking payload was incomplete.",
          warnings: [],
          errors: ["missing_booking_payload"],
        };
      }

      const booking = await this.apiCoreAdapter.createBooking(params.session, bookingPreview.payload);
      return {
        requestId: params.pendingAction.requestId,
        executionStatus: "executed",
        result: {
          booking,
        },
        summary: `Booked ${booking.serviceName ?? booking.serviceId} for ${booking.memberName ?? booking.memberId}.`,
        warnings: params.pendingAction.warnings,
      };
    }

    if (bookingPreview.operation === "reschedule" && bookingPreview.bookingId && bookingPreview.scheduledAt) {
      const booking = await this.apiCoreAdapter.updateBooking(params.session, {
        bookingId: bookingPreview.bookingId,
        fromTime: bookingPreview.scheduledAt,
        toTime: bookingPreview.endAt,
        practitionerId: bookingPreview.practitionerId,
      });
      return {
        requestId: params.pendingAction.requestId,
        executionStatus: "executed",
        result: {
          booking,
        },
        summary: `Rescheduled booking ${booking.id} to ${booking.fromTime}.`,
        warnings: params.pendingAction.warnings,
      };
    }

    if (bookingPreview.operation === "cancel" && bookingPreview.bookingId) {
      const booking = await this.apiCoreAdapter.cancelBooking(params.session, bookingPreview.bookingId);
      return {
        requestId: params.pendingAction.requestId,
        executionStatus: "executed",
        result: {
          booking,
        },
        summary: `Cancelled booking ${booking.id}.`,
        warnings: params.pendingAction.warnings,
      };
    }

    return {
      requestId: params.pendingAction.requestId,
      executionStatus: "failed",
      summary: "Unsupported booking execution path.",
      warnings: params.pendingAction.warnings,
      errors: ["unsupported_booking_operation"],
    };
  }
}
