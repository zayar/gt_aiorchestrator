import { AppError } from "./errors.js";

export const requireConfirmation = (confirmed: boolean) => {
  if (!confirmed) {
    throw new AppError("This action requires explicit confirmation.", {
      statusCode: 400,
      code: "confirmation_required",
    });
  }
};

export const requireString = (value: unknown, code: string, message: string): string => {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    throw new AppError(message, {
      statusCode: 400,
      code,
    });
  }
  return trimmed;
};
