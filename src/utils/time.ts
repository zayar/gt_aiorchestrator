import type { GTReportPeriod } from "../types/domain.js";

const weekdayIndex: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const setClock = (date: Date, hours: number, minutes = 0): Date => {
  const next = new Date(date);
  next.setHours(hours, minutes, 0, 0);
  return next;
};

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const getZonedParts = (date: Date, timeZone: string): ZonedParts => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);

  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
  };
};

const toLocalCalendarDate = (date: Date, timeZone: string): Date => {
  const parts = getZonedParts(date, timeZone);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 0, 0, 0, 0));
};

const zonedTimeToUtc = (
  local: {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second?: number;
  },
  timeZone: string,
): Date => {
  const target = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second ?? 0, 0);
  let guess = new Date(target);

  for (let index = 0; index < 4; index += 1) {
    const actual = getZonedParts(guess, timeZone);
    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
      0,
    );
    const delta = target - actualAsUtc;
    if (delta === 0) {
      return guess;
    }
    guess = new Date(guess.getTime() + delta);
  }

  return guess;
};

const startOfDay = (date: Date): Date => setClock(date, 0, 0);
const endOfDay = (date: Date): Date => setClock(date, 23, 59);

const nextWeekday = (baseDate: Date, targetDay: number): Date => {
  const next = startOfDay(baseDate);
  const distance = (targetDay - next.getDay() + 7) % 7 || 7;
  next.setDate(next.getDate() + distance);
  return next;
};

export const formatDateTimeLabel = (date: Date, timeZone = "UTC"): string =>
  date.toLocaleString("en-US", {
    timeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export const buildEndTime = (startAt: Date, durationMinutes = 60): Date => {
  const endAt = new Date(startAt);
  endAt.setMinutes(endAt.getMinutes() + durationMinutes);
  return endAt;
};

export const parseDateTimeHint = (text: string, now = new Date(), timeZone = "UTC") => {
  const normalized = String(text ?? "").toLowerCase();
  let baseDate: Date | null = null;
  let confidence = 0;
  const todayLocal = toLocalCalendarDate(now, timeZone);

  if (normalized.includes("today")) {
    baseDate = todayLocal;
    confidence += 0.35;
  } else if (normalized.includes("tomorrow")) {
    baseDate = new Date(todayLocal);
    baseDate.setUTCDate(baseDate.getUTCDate() + 1);
    confidence += 0.4;
  } else {
    const weekday = Object.entries(weekdayIndex).find(([label]) => normalized.includes(label));
    if (weekday) {
      baseDate = nextWeekday(todayLocal, weekday[1]);
      confidence += 0.35;
    }
  }

  const timeMatch = normalized.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  let hours: number | null = null;
  let minutes = 0;

  if (timeMatch) {
    hours = Number(timeMatch[1]);
    minutes = Number(timeMatch[2] ?? 0);
    const meridiem = timeMatch[3];
    if (meridiem === "pm" && hours < 12) {
      hours += 12;
    }
    if (meridiem === "am" && hours === 12) {
      hours = 0;
    }
    confidence += 0.45;
  } else if (normalized.includes("morning")) {
    hours = 9;
    confidence += 0.22;
  } else if (normalized.includes("afternoon")) {
    hours = 14;
    confidence += 0.22;
  } else if (normalized.includes("evening")) {
    hours = 18;
    confidence += 0.22;
  }

  if (!baseDate && hours !== null) {
    baseDate = todayLocal;
  }

  if (!baseDate || hours === null) {
    return {
      startAt: null,
      confidence,
      missingDate: !baseDate,
      missingTime: hours === null,
    };
  }

  const startAt = zonedTimeToUtc(
    {
      year: baseDate.getUTCFullYear(),
      month: baseDate.getUTCMonth() + 1,
      day: baseDate.getUTCDate(),
      hour: hours,
      minute: minutes,
    },
    timeZone,
  );
  return {
    startAt,
    confidence: Math.min(confidence, 1),
    missingDate: false,
    missingTime: false,
  };
};

export const inferReportPeriod = (text: string, now = new Date(), timeZone = "UTC"): GTReportPeriod => {
  const normalized = String(text ?? "").toLowerCase();
  const todayLocal = toLocalCalendarDate(now, timeZone);

  const toUtcBoundary = (localDate: Date, hours: number, minutes: number): string =>
    zonedTimeToUtc(
      {
        year: localDate.getUTCFullYear(),
        month: localDate.getUTCMonth() + 1,
        day: localDate.getUTCDate(),
        hour: hours,
        minute: minutes,
      },
      timeZone,
    ).toISOString();

  if (normalized.includes("this week") || normalized.includes("week")) {
    const start = new Date(todayLocal);
    start.setUTCDate(start.getUTCDate() - start.getUTCDay());
    return {
      label: "this week",
      fromDate: toUtcBoundary(start, 0, 0),
      toDate: toUtcBoundary(todayLocal, 23, 59),
    };
  }

  if (normalized.includes("this month") || normalized.includes("month")) {
    const start = new Date(Date.UTC(todayLocal.getUTCFullYear(), todayLocal.getUTCMonth(), 1, 0, 0, 0, 0));
    return {
      label: "this month",
      fromDate: toUtcBoundary(start, 0, 0),
      toDate: toUtcBoundary(todayLocal, 23, 59),
    };
  }

  return {
    label: "today",
    fromDate: toUtcBoundary(todayLocal, 0, 0),
    toDate: toUtcBoundary(todayLocal, 23, 59),
  };
};
