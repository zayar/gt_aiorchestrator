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

const startOfDay = (date: Date): Date => setClock(date, 0, 0);
const endOfDay = (date: Date): Date => setClock(date, 23, 59);

const nextWeekday = (baseDate: Date, targetDay: number): Date => {
  const next = startOfDay(baseDate);
  const distance = (targetDay - next.getDay() + 7) % 7 || 7;
  next.setDate(next.getDate() + distance);
  return next;
};

export const formatDateTimeLabel = (date: Date): string =>
  date.toLocaleString("en-US", {
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

export const parseDateTimeHint = (text: string, now = new Date()) => {
  const normalized = String(text ?? "").toLowerCase();
  let baseDate: Date | null = null;
  let confidence = 0;

  if (normalized.includes("today")) {
    baseDate = startOfDay(now);
    confidence += 0.35;
  } else if (normalized.includes("tomorrow")) {
    baseDate = startOfDay(now);
    baseDate.setDate(baseDate.getDate() + 1);
    confidence += 0.4;
  } else {
    const weekday = Object.entries(weekdayIndex).find(([label]) => normalized.includes(label));
    if (weekday) {
      baseDate = nextWeekday(now, weekday[1]);
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
    baseDate = startOfDay(now);
  }

  if (!baseDate || hours === null) {
    return {
      startAt: null,
      confidence,
      missingDate: !baseDate,
      missingTime: hours === null,
    };
  }

  const startAt = setClock(baseDate, hours, minutes);
  return {
    startAt,
    confidence: Math.min(confidence, 1),
    missingDate: false,
    missingTime: false,
  };
};

export const inferReportPeriod = (text: string, now = new Date()): GTReportPeriod => {
  const normalized = String(text ?? "").toLowerCase();

  if (normalized.includes("this week") || normalized.includes("week")) {
    const start = startOfDay(now);
    start.setDate(start.getDate() - start.getDay());
    return {
      label: "this week",
      fromDate: start.toISOString(),
      toDate: endOfDay(now).toISOString(),
    };
  }

  if (normalized.includes("this month") || normalized.includes("month")) {
    const start = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
    return {
      label: "this month",
      fromDate: start.toISOString(),
      toDate: endOfDay(now).toISOString(),
    };
  }

  return {
    label: "today",
    fromDate: startOfDay(now).toISOString(),
    toDate: endOfDay(now).toISOString(),
  };
};
