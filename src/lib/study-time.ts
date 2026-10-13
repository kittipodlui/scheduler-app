export const STUDY_END_TIME = "22:00";
export const LUNCH_BREAK_START_HOUR = 12;
export const LUNCH_BREAK_END_HOUR = 13;
export const REST_BREAK_AFTER_SESSIONS = 2;
export const REST_BREAK_MINUTES = 25;

export type StudyTimeSlot = {
  startTime: string;
  endTime: string;
};

export type StudyBreak = {
  afterSessionIndex: number;
  label: string;
};

export function isValidStudyStartTime(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^(0[6-9]|1[0-9]|2[01]):00$/.test(value)
  );
}

export function isValidStudyEndTime(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^(0[6-9]|1[0-9]|2[0-3]):00$/.test(value)
  );
}

function formatTime(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * แปลงเวลา HH:mm เป็นจำนวนนาที
 *
 * รองรับค่าที่ runtime อาจส่งมาเป็น:
 * - "20:00"
 * - Date
 * - number
 *
 * เพื่อป้องกัน error:
 * "time.split is not a function"
 */
function toMinutes(time: unknown): number {
  let normalizedTime: string;

  if (typeof time === "string") {
    normalizedTime = time;
  } else if (time instanceof Date) {
    normalizedTime = `${String(time.getHours()).padStart(2, "0")}:${String(
      time.getMinutes(),
    ).padStart(2, "0")}`;
  } else if (typeof time === "number" && Number.isFinite(time)) {
    const totalMinutes = Math.floor(time);

    if (totalMinutes >= 0 && totalMinutes <= 1439) {
      return totalMinutes;
    }

    throw new TypeError(`Invalid numeric time value: ${time}`);
  } else {
    throw new TypeError(
      `Invalid time value: ${String(time)}`,
    );
  }

  const parts = normalizedTime.split(":");

  if (parts.length !== 2) {
    throw new TypeError(
      `Invalid time format: ${normalizedTime}. Expected HH:mm`,
    );
  }

  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);

  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    throw new TypeError(
      `Invalid time value: ${normalizedTime}. Expected HH:mm`,
    );
  }

  return hours * 60 + minutes;
}

export function getStudyDayTimeline(
  startTime: string,
  endTime: string = STUDY_END_TIME,
): {
  sessions: StudyTimeSlot[];
  breaks: StudyBreak[];
} {
  const lunchStart = LUNCH_BREAK_START_HOUR * 60;
  const lunchEnd = LUNCH_BREAK_END_HOUR * 60;
  const endOfDay = toMinutes(endTime);

  const sessions: StudyTimeSlot[] = [];
  const restBreaks = new Set<number>();

  let nextStart = toMinutes(startTime);
  let consecutiveSessions = 0;

  while (nextStart + 60 <= endOfDay) {
    // ข้ามช่วงพักกลางวัน
    if (nextStart < lunchEnd && nextStart + 60 > lunchStart) {
      nextStart = lunchEnd;
      consecutiveSessions = 0;
    }

    if (nextStart + 60 > endOfDay) {
      break;
    }

    const end = nextStart + 60;

    sessions.push({
      startTime: formatTime(nextStart),
      endTime: formatTime(end),
    });

    consecutiveSessions += 1;
    nextStart = end;

    // พักทุก 2 session
    if (consecutiveSessions === REST_BREAK_AFTER_SESSIONS) {
      let nextSessionStart = nextStart + REST_BREAK_MINUTES;

      const restOverlapsLunch =
        nextStart < lunchEnd && nextSessionStart > lunchStart;

      if (
        nextSessionStart < lunchEnd &&
        nextSessionStart + 60 > lunchStart
      ) {
        nextSessionStart = lunchEnd;
      }

      if (!restOverlapsLunch) {
        restBreaks.add(sessions.length - 1);
      }

      nextStart = nextSessionStart;
      consecutiveSessions = 0;
    }
  }

  const breaks: StudyBreak[] = [];

  for (let index = 0; index < sessions.length - 1; index += 1) {
    const currentEnd = toMinutes(sessions[index].endTime);
    const nextSessionStart = toMinutes(
      sessions[index + 1].startTime,
    );

    if (nextSessionStart <= currentEnd) {
      continue;
    }

    const labels: string[] = [];

    if (restBreaks.has(index)) {
      labels.push(`พัก ${REST_BREAK_MINUTES} นาที`);
    }

    if (currentEnd < lunchEnd && nextSessionStart > lunchStart) {
      labels.push(
        `พักกลางวัน ${formatTime(lunchStart)}–${formatTime(lunchEnd)}`,
      );
    }

    if (labels.length === 0) {
      labels.push(
        `พัก ${nextSessionStart - currentEnd} นาที`,
      );
    }

    breaks.push({
      afterSessionIndex: index,
      label: labels.join(" · "),
    });
  }

  return {
    sessions,
    breaks,
  };
}

export function getStudySessionsPerDay(
  startTime: string,
  endTime: string = STUDY_END_TIME,
): number {
  return getStudyDayTimeline(startTime, endTime).sessions.length;
}

export function getSessionTimeRange(
  startTime: string,
  endTime: string = STUDY_END_TIME,
  sessionIndex: number,
): string {
  const session = getStudyDayTimeline(
    startTime,
    endTime,
  ).sessions[sessionIndex];

  if (!session) {
    throw new RangeError(
      `No study session exists at index ${sessionIndex}`,
    );
  }

  return `${session.startTime}–${session.endTime}`;
}