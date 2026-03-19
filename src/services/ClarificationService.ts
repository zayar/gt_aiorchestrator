import type { CandidateOption, ClarificationPayload, MissingFieldKey } from "../types/contracts.js";

export class ClarificationService {
  missingField(message: string, missingFields: MissingFieldKey[], options: CandidateOption[] = []): ClarificationPayload {
    return {
      type: "missing_field",
      message,
      missingFields,
      options,
    };
  }

  ambiguousEntity(message: string, options: CandidateOption[], missingFields: MissingFieldKey[] = []): ClarificationPayload {
    return {
      type: "ambiguous_entity",
      message,
      missingFields,
      options,
    };
  }

  unavailableSlot(message: string, options: CandidateOption[] = []): ClarificationPayload {
    return {
      type: "unavailable_slot",
      message,
      missingFields: [],
      options,
    };
  }

  outOfStock(message: string, options: CandidateOption[] = []): ClarificationPayload {
    return {
      type: "out_of_stock",
      message,
      missingFields: [],
      options,
    };
  }

  unsupported(message: string): ClarificationPayload {
    return {
      type: "unsupported",
      message,
      missingFields: [],
      options: [],
    };
  }
}
