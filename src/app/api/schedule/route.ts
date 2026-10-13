import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getSessionUser } from "@/lib/auth";
import { getOwnedCategory } from "@/lib/categories";
import { createImprovedGeneticStudySchedule } from "@/lib/genetic-algorithm";
import { ensureDatabase, getPool, getUserSubjectLists } from "@/lib/database";
import type { SubjectPreference } from "@/lib/subjects";
import {
  getSessionTimeRange,
  getStudySessionsPerDay,
  isValidStudyStartTime,
  isValidStudyEndTime,
} from "@/lib/study-time";
import { isPriorityWeight, type PriorityWeight } from "@/lib/subjects";

export const runtime = "nodejs";

type ScheduleRow = RowDataPacket & {
  id: number;
  week_start_date: string;
  days_per_week: number;
  sessions_per_day: number;
  start_time: string;
  end_time: string;
  created_at: Date;
};

type SessionRow = RowDataPacket & {
  id: number;
  day_index: number;
  session_index: number;
  subject_key: string;
  is_completed: number;
  future_note: string | null;
  lecture_notes: string | null;
};

type ManualBlockRow = RowDataPacket & {
  day_index: number;
  startTime: string;
  durationMinutes: number;
};

type CrossCategorySessionRow = RowDataPacket & {
  categoryName: string;
  dayIndex: number;
  sessionIndex: number;
  startTime: string;
  endTime: string;
};

type CrossCategoryManualRow = RowDataPacket & {
  categoryName: string;
  dayIndex: number;
  scheduledDate: string | null;
  startTime: string;
  durationMinutes: number;
};

type TimedActivityRow = RowDataPacket & {
  categoryName: string;
  title: string;
  startDate: string | null;
  endDate: string | null;
  startTime: string;
  endTime: string;
};

const DAY_LABELS = ["วันจันทร์", "วันอังคาร", "วันพุธ", "วันพฤหัสบดี", "วันศุกร์", "วันเสาร์", "วันอาทิตย์"] as const;

function getWeekDate(weekStartDate: string, dayIndex: number): string {
  const date = new Date(weekStartDate + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + dayIndex);
  return date.toISOString().slice(0, 10);
}

function toMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function getCurrentWeekStartDate(): string {
  const date = new Date();
  const mondayOffset = (date.getDay() + 6) % 7;

  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - mondayOffset);

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return year + "-" + month + "-" + day;
}

function isValidWeekStartDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) {
    return false;
  }

  const date = new Date(value + "T00:00:00Z");
  if (Number.isNaN(date.getTime())) return false;

  const [year, month, day] = value.split("-").map(Number);

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() + 1 === month &&
    date.getUTCDate() === day &&
    date.getUTCDay() === 1
  );
}

function rangesOverlap(
  firstStart: number,
  firstEnd: number,
  secondStart: number,
  secondEnd: number,
): boolean {
  return firstStart < secondEnd && secondStart < firstEnd;
}

function respondWithError(error: unknown): Response {
  const detail =
    error instanceof Error ? error.message : "เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ";
  const isConfigurationError = detail.includes(".env.local");
  console.error("Study schedule API error:", detail);
  const errorCode =
    error && typeof error === "object" && "code" in error
      ? error.code
      : undefined;
  if (errorCode === "ER_ACCESS_DENIED_ERROR") {
    return Response.json(
      {
        error:
          "MySQL ปฏิเสธการเข้าสู่ระบบ ตรวจสอบ MYSQL_USER และ MYSQL_PASSWORD ในไฟล์ .env.local",
      },
      { status: 503 },
    );
  }
  return Response.json(
    {
      error: isConfigurationError
        ? detail
        : "เชื่อมต่อหรือบันทึก MySQL ไม่สำเร็จ ตรวจสอบสถานะเซิร์ฟเวอร์และค่าการเชื่อมต่อ",
    },
    { status: isConfigurationError ? 503 : 500 },
  );
}

export async function GET(request: Request): Promise<Response> {
  try {
    const pool = getPool();
    await ensureDatabase(pool);
    const user = await getSessionUser(request, pool);
    if (!user)
      return Response.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
    const searchParams = new URL(request.url).searchParams;
    const categoryId = Number(searchParams.get("categoryId"));
    const requestedWeekStartDate = searchParams.get("weekStartDate");
    const weekStartDate =
      requestedWeekStartDate === null
        ? getCurrentWeekStartDate()
        : requestedWeekStartDate;

    if (!isValidWeekStartDate(weekStartDate)) {
      return Response.json(
        {
          error:
            "weekStartDate ไม่ถูกต้อง ต้องเป็นวันจันทร์ในรูปแบบ YYYY-MM-DD",
        },
        { status: 400 },
      );
    }
    const category =
      Number.isSafeInteger(categoryId) && categoryId > 0
        ? await getOwnedCategory(pool, user.id, categoryId)
        : null;
    if (!category)
      return Response.json(
        { error: "กรุณาเลือกหมวดที่เป็นของบัญชีคุณ" },
        { status: 400 },
      );
    const [schedules] = await pool.query<ScheduleRow[]>(
      `SELECT
         id,
         DATE_FORMAT(week_start_date, '%Y-%m-%d') AS week_start_date,
         days_per_week,
         sessions_per_day,
         start_time,
         end_time,
         created_at
       FROM schedules
       WHERE user_id = ?
         AND category_id = ?
         AND week_start_date = ?
       ORDER BY id DESC
       LIMIT 1`,
      [user.id, category.id, weekStartDate],
    );

    // A date with no schedule starts with a clean, week-specific subject list.
    let { subjects, availableSubjects } = await getUserSubjectLists(
      pool,
      user.id,
      category.id,
      weekStartDate,
    );
    if (!schedules[0]) {
      // Keep legacy, pre-GA subjects visible only before this category has ever
      // had a saved schedule. After a saved week exists, a new week starts blank.
      const [existingScheduleRows] = await pool.execute<RowDataPacket[]>(
        "SELECT id FROM schedules WHERE user_id = ? AND category_id = ? LIMIT 1",
        [user.id, category.id],
      );
      if (!existingScheduleRows.length && !subjects.length) {
        const legacyLists = await getUserSubjectLists(pool, user.id, category.id, null);
        if (legacyLists.subjects.length) {
          return Response.json({
            subjects: legacyLists.subjects,
            availableSubjects: legacyLists.availableSubjects,
            schedule: null,
          });
        }
      }
      return Response.json({ subjects, availableSubjects, schedule: null });
    }

    const latest = schedules[0];
    const [sessions] = await pool.execute<SessionRow[]>(
      "SELECT id, day_index, session_index, subject_key, is_completed, future_note, lecture_notes FROM study_sessions WHERE schedule_id = ? ORDER BY day_index, session_index",
      [latest.id],
    );
    const scopeHasAllSessions = sessions.every((session) =>
      subjects.some((subject) => subject.key === session.subject_key),
    );

    // Preserve schedules created before week-specific subjects were introduced.
    if (!scopeHasAllSessions) {
      const baselineLists = await getUserSubjectLists(pool, user.id, category.id, null);
      const baselineHasAllSessions = sessions.every((session) =>
        baselineLists.subjects.some((subject) => subject.key === session.subject_key),
      );
      if (baselineHasAllSessions) {
        subjects = baselineLists.subjects;
        availableSubjects = baselineLists.availableSubjects;
      } else {
        return Response.json({ subjects, availableSubjects, schedule: null });
      }
    }
    return Response.json({
      subjects,
      availableSubjects,
      schedule: {
        id: latest.id,
        weekStartDate: latest.week_start_date,
        daysPerWeek: latest.days_per_week,
        sessionsPerDay: latest.sessions_per_day,
        startTime: latest.start_time.slice(0, 5),
        endTime: latest.end_time.slice(0, 5),
        createdAt: latest.created_at,
        sessions: sessions.map((session) => ({
          id: session.id,
          dayIndex: session.day_index,
          sessionIndex: session.session_index,
          subjectKey: session.subject_key,
          isCompleted: Boolean(session.is_completed),
          futureNote: session.future_note ?? "",
          lectureNotes: session.lecture_notes ?? "",
        })),
      },
    });
  } catch (error) {
    return respondWithError(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const pool = getPool();
    await ensureDatabase(pool);
    const user = await getSessionUser(request, pool);
    if (!user)
      return Response.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });

    const body: unknown = await request.json();
    if (!body || typeof body !== "object") {
      return Response.json(
        { error: "ข้อมูลตั้งค่าไม่ถูกต้อง" },
        { status: 400 },
      );
    }

    const input = body as Record<string, unknown>;
    const categoryId = Number(input.categoryId);
    const category =
      Number.isSafeInteger(categoryId) && categoryId > 0
        ? await getOwnedCategory(pool, user.id, categoryId)
        : null;
    if (!category)
      return Response.json(
        { error: "กรุณาเลือกหมวดที่เป็นของบัญชีคุณ" },
        { status: 400 },
      );
    const daysPerWeek = input.daysPerWeek;
    const startTime = input.startTime;
    const endTime = input.endTime;
    const requestedWeekStartDate = input.weekStartDate;
    const weekStartDate =
      requestedWeekStartDate === undefined
        ? getCurrentWeekStartDate()
        : requestedWeekStartDate;

    if (!isValidWeekStartDate(weekStartDate)) {
      return Response.json(
        {
          error:
            "สัปดาห์ไม่ถูกต้อง ต้องระบุวันจันทร์ในรูปแบบ YYYY-MM-DD",
        },
        { status: 400 },
      );
    }

    if (!isValidStudyStartTime(startTime)) {
      return Response.json(
        {
          error: "เลือกเวลาเริ่มอ่านเป็นชั่วโมงเต็ม ตั้งแต่ 06:00 ถึง 21:00",
        },
        { status: 400 },
      );
    }

    if (!isValidStudyEndTime(endTime)) {
  return Response.json(
    {
      error: "เวลาเลิกอ่านไม่ถูกต้อง",
    },
    { status: 400 },
  );
}

    if (toMinutes(endTime) <= toMinutes(startTime)) {
      return Response.json(
        {
          error: "เวลาสิ้นสุดต้องมากกว่าเวลาเริ่มอ่าน",
        },
        { status: 400 },
      );
    }

    const sessionsPerDay = getStudySessionsPerDay(startTime, endTime);
    const submittedSubjects = input.subjects;
    if (
      !Number.isInteger(daysPerWeek) ||
      (daysPerWeek as number) < 1 ||
      (daysPerWeek as number) > 7 ||
      !Array.isArray(submittedSubjects) ||
      submittedSubjects.length < 1 ||
      submittedSubjects.length > 50
    ) {
      return Response.json(
        { error: "จำนวนวันหรือรายการวิชาอยู่นอกช่วงที่กำหนด" },
        { status: 400 },
      );
    }

    const submitted = submittedSubjects as Array<Partial<SubjectPreference>>;
    const { subjects: weekSubjects } = await getUserSubjectLists(
      pool,
      user.id,
      category.id,
      weekStartDate,
    );
    // Existing schedules may still use the original shared subject records
    // (schedule_only_date IS NULL). Accept that complete legacy list when
    // the UI loaded it as a fallback, but never mix it with another week's
    // subjects.
    const { subjects: sharedSubjects } = await getUserSubjectLists(
      pool,
      user.id,
      category.id,
      null,
    );
    const submittedKeys = submitted.map((subject) => subject?.key);
    const uniqueKeys = new Set(submittedKeys).size === submitted.length;
    // Accept only the supported percentages, while tolerating numeric strings
    // from an older client/cache. All later calculations use the normalized number.
    const normalizedWeights = submitted.map((subject) => Number(subject.weight));
    const validWeights = submitted.every(
      (subject, index) =>
        typeof subject.key === "string" &&
        isPriorityWeight(normalizedWeights[index]),
    );
    const weekByKey = new Map(
      weekSubjects.map((subject) => [subject.key, subject]),
    );
    const sharedByKey = new Map(
      sharedSubjects.map((subject) => [subject.key, subject]),
    );
    const allBelongToWeek = submitted.every(
      (subject) =>
        typeof subject.key === "string" && weekByKey.has(subject.key),
    );
    const allBelongToShared = submitted.every(
      (subject) =>
        typeof subject.key === "string" && sharedByKey.has(subject.key),
    );

    // The shared/legacy subject list is allowed only when regenerating a week
    // that already has a saved schedule, or for a category that has never
    // had a schedule. A brand-new week must not pull subjects from older weeks.
    const [sameWeekScheduleRows] = await pool.execute<RowDataPacket[]>(
      "SELECT id FROM schedules WHERE user_id = ? AND category_id = ? AND week_start_date = ? LIMIT 1",
      [user.id, category.id, weekStartDate],
    );
    const [anyScheduleRows] = await pool.execute<RowDataPacket[]>(
      "SELECT id FROM schedules WHERE user_id = ? AND category_id = ? LIMIT 1",
      [user.id, category.id],
    );
    const allowSharedSubjects =
      sameWeekScheduleRows.length > 0 ||
      (anyScheduleRows.length === 0 && weekSubjects.length === 0);
    const selectedSubjectMap = allBelongToWeek
      ? weekByKey
      : allowSharedSubjects && allBelongToShared
        ? sharedByKey
        : null;

    if (!uniqueKeys || !validWeights || !selectedSubjectMap) {
      const error = !uniqueKeys
        ? "พบรายการวิชาซ้ำ กรุณาตรวจสอบรายวิชาก่อนสร้างตาราง"
        : !validWeights
          ? "Weight ของทุกวิชาต้องเป็น 10%, 20%, 25% หรือ 30%"
          : "รายวิชาที่ส่งมาไม่ตรงกับสัปดาห์ที่เลือก กรุณาโหลดสัปดาห์ใหม่แล้วตรวจสอบรายการวิชา";
      return Response.json({ error }, { status: 400 });
    }
    const subjects: SubjectPreference[] = submitted.map((subject, index) => ({
      ...selectedSubjectMap.get(subject.key!)!,
      weight: normalizedWeights[index] as PriorityWeight,
    }));

    // ตรวจสอบ Weight รวมต้องเท่ากับ 100% พอดี
    const totalWeight = subjects.reduce(
      (total, subject) => total + Number(subject.weight),
      0,
    );

    if (totalWeight !== 100) {
      return Response.json(
        {
          error: `ไม่สามารถสร้างตารางได้ Weight รวมต้องเท่ากับ 100% พอดี (ปัจจุบัน ${totalWeight}%)`,
        },
        { status: 400 },
      );
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      // Preserve completed sessions when the automatic schedule is regenerated.
      // A completion stays checked when the same subject remains in the same slot.
      const completedSessionKeys = new Set<string>();
      const previousSessionNotes = new Map<
        string,
        { futureNote: string; lectureNotes: string }
      >();
      const [previousSchedules] = await connection.query<ScheduleRow[]>(
        "SELECT id FROM schedules WHERE user_id = ? AND category_id = ? AND week_start_date = ? ORDER BY id DESC LIMIT 1",
        [user.id, category.id, weekStartDate],
      );
      if (previousSchedules[0]) {
        const [previousSessions] = await connection.execute<SessionRow[]>(
          "SELECT day_index, session_index, subject_key, is_completed, future_note, lecture_notes FROM study_sessions WHERE schedule_id = ?",
          [previousSchedules[0].id],
        );
        for (const previousSession of previousSessions) {
          const key = `${previousSession.day_index}:${previousSession.session_index}:${previousSession.subject_key}`;
          if (previousSession.is_completed) completedSessionKeys.add(key);
          previousSessionNotes.set(key, {
            futureNote: previousSession.future_note ?? "",
            lectureNotes: previousSession.lecture_notes ?? "",
          });
        }
      }
      for (const subject of subjects) {
        await connection.execute(
          "UPDATE user_subject_preferences SET weight = ? WHERE user_id = ? AND subject_key = ? AND is_added = 1",
          [subject.weight, user.id, subject.key],
        );
      }

      const scheduleSeed = JSON.stringify({
        userId: user.id,
        categoryId: category.id,
        weekStartDate,
        daysPerWeek,
        startTime,
        endTime,
        subjects: subjects.map((subject) => [subject.key, subject.weight]),
      });
      // Use the improved GA in live schedule generation; the legacy GA remains available for benchmarks.
      const grid = createImprovedGeneticStudySchedule(
        subjects,
        daysPerWeek as number,
        sessionsPerDay as number,
        scheduleSeed,
      );
      const [manualBlocks] = await connection.execute<ManualBlockRow[]>(
        "SELECT day_index, TIME_FORMAT(start_time, '%H:%i') AS startTime, duration_minutes AS durationMinutes FROM manual_study_blocks WHERE user_id = ? AND category_id = ? AND (scheduled_date IS NULL OR (scheduled_date >= ? AND scheduled_date < DATE_ADD(?, INTERVAL 7 DAY)))",
        [user.id, category.id, weekStartDate, weekStartDate],
      );
      const hasManualConflict = manualBlocks.some((block) =>
        grid[block.day_index]?.some((_, sessionIndex) => {
          const [sessionStart, sessionEnd] = getSessionTimeRange(
            startTime,
            endTime,
            sessionIndex,
          ).split("–");
          return rangesOverlap(
            toMinutes(block.startTime),
            toMinutes(block.startTime) + Number(block.durationMinutes),
            toMinutes(sessionStart),
            toMinutes(sessionEnd),
          );
        }),
      );
      if (hasManualConflict) {
        await connection.rollback();
        return Response.json(
          {
            error:
              "จัดตารางไม่ได้ เนื่องจากมีช่วงเรียนที่จัดไว้ในวันเดียวกันแล้ว กรุณาย้ายหรือลบช่วงเรียนที่ชนก่อน",
          },
          { status: 409 },
        );
      }

      // Never permit a generated schedule to overlap another category's existing schedule.
      const [existingSessions] = await connection.execute<CrossCategorySessionRow[]>(
        `SELECT c.name AS categoryName, ss.day_index AS dayIndex, ss.session_index AS sessionIndex,
                TIME_FORMAT(s.start_time, '%H:%i') AS startTime,
                TIME_FORMAT(s.end_time, '%H:%i') AS endTime
         FROM schedules s
         INNER JOIN study_sessions ss ON ss.schedule_id = s.id
         INNER JOIN study_categories c ON c.id = s.category_id
         WHERE s.user_id = ? AND s.category_id <> ? AND s.week_start_date = ?
           AND s.id = (SELECT MAX(s2.id) FROM schedules s2
                       WHERE s2.user_id = s.user_id AND s2.category_id = s.category_id
                         AND s2.week_start_date = s.week_start_date)`,
        [user.id, category.id, weekStartDate],
      );
      let scheduleConflict: { categoryName: string; dayIndex: number; existingTime: string; proposedTime: string } | null = null;
      for (let dayIndex = 0; dayIndex < grid.length && !scheduleConflict; dayIndex += 1) {
        for (let sessionIndex = 0; sessionIndex < grid[dayIndex].length && !scheduleConflict; sessionIndex += 1) {
          const [proposedStart, proposedEnd] = getSessionTimeRange(startTime as string, endTime as string, sessionIndex).split("–");
          const existing = existingSessions.find((slot) => {
            if (Number(slot.dayIndex) !== dayIndex) return false;
            const [existingStart, existingEnd] = getSessionTimeRange(slot.startTime, slot.endTime, Number(slot.sessionIndex)).split("–");
            return rangesOverlap(toMinutes(proposedStart), toMinutes(proposedEnd), toMinutes(existingStart), toMinutes(existingEnd));
          });
          if (existing) {
            const [existingStart, existingEnd] = getSessionTimeRange(existing.startTime, existing.endTime, Number(existing.sessionIndex)).split("–");
            scheduleConflict = { categoryName: existing.categoryName, dayIndex, existingTime: existingStart + "–" + existingEnd, proposedTime: proposedStart + "–" + proposedEnd };
          }
        }
      }
      if (scheduleConflict) {
        await connection.rollback();
        return Response.json({
          error: `จัดตารางไม่ได้ เนื่องจาก ${DAY_LABELS[scheduleConflict.dayIndex]} มีตารางของหมวด “${scheduleConflict.categoryName}” เวลา ${scheduleConflict.existingTime} อยู่แล้ว (เวลาที่ชน: ${scheduleConflict.proposedTime}) กรุณาปรับเวลาในหมวดนี้ก่อน`,
        }, { status: 409 });
      }

      // Manual blocks in other categories are also reserved time slots for this week.
      const [otherManualBlocks] = await connection.execute<CrossCategoryManualRow[]>(
        `SELECT c.name AS categoryName, b.day_index AS dayIndex,
                DATE_FORMAT(b.scheduled_date, '%Y-%m-%d') AS scheduledDate,
                TIME_FORMAT(b.start_time, '%H:%i') AS startTime, b.duration_minutes AS durationMinutes
         FROM manual_study_blocks b
         INNER JOIN study_categories c ON c.id = b.category_id
         WHERE b.user_id = ? AND b.category_id <> ?
           AND (b.scheduled_date IS NULL OR (b.scheduled_date >= ? AND b.scheduled_date < DATE_ADD(?, INTERVAL 7 DAY)))`,
        [user.id, category.id, weekStartDate, weekStartDate],
      );
      let manualConflict: { categoryName: string; dayIndex: number; existingTime: string; proposedTime: string } | null = null;
      for (let dayIndex = 0; dayIndex < grid.length && !manualConflict; dayIndex += 1) {
        const dateKey = getWeekDate(weekStartDate as string, dayIndex);
        for (let sessionIndex = 0; sessionIndex < grid[dayIndex].length && !manualConflict; sessionIndex += 1) {
          const [proposedStart, proposedEnd] = getSessionTimeRange(startTime as string, endTime as string, sessionIndex).split("–");
          const existing = otherManualBlocks.find((block) => {
            if (block.scheduledDate ? block.scheduledDate !== dateKey : Number(block.dayIndex) !== dayIndex) return false;
            return rangesOverlap(toMinutes(proposedStart), toMinutes(proposedEnd), toMinutes(block.startTime), toMinutes(block.startTime) + Number(block.durationMinutes));
          });
          if (existing) {
            const [hours, minutes] = existing.startTime.split(":").map(Number);
            const totalEnd = hours * 60 + minutes + Number(existing.durationMinutes);
            const existingEnd = String(Math.floor(totalEnd / 60) % 24).padStart(2, "0") + ":" + String(totalEnd % 60).padStart(2, "0");
            manualConflict = { categoryName: existing.categoryName, dayIndex, existingTime: existing.startTime + "–" + existingEnd, proposedTime: proposedStart + "–" + proposedEnd };
          }
        }
      }
      if (manualConflict) {
        await connection.rollback();
        return Response.json({
          error: `จัดตารางไม่ได้ เนื่องจาก${DAY_LABELS[manualConflict.dayIndex]}มีช่วงเรียนที่เพิ่มเองในหมวด “${manualConflict.categoryName}” เวลา ${manualConflict.existingTime} อยู่แล้ว (เวลาที่ชน: ${manualConflict.proposedTime}) กรุณาปรับเวลาในหมวดนี้ก่อน`,
        }, { status: 409 });
      }

      // Dated activities with explicit time ranges also reserve their time on that date.
      const [timedActivities] = await connection.execute<TimedActivityRow[]>(
        `SELECT c.name AS categoryName, a.title,
                DATE_FORMAT(a.start_date, '%Y-%m-%d') AS startDate,
                DATE_FORMAT(a.end_date, '%Y-%m-%d') AS endDate,
                TIME_FORMAT(a.start_time, '%H:%i') AS startTime,
                TIME_FORMAT(a.end_time, '%H:%i') AS endTime
         FROM study_activities a
         INNER JOIN study_categories c ON c.id = a.category_id
         WHERE a.user_id = ? AND a.start_time IS NOT NULL AND a.end_time IS NOT NULL
           AND (a.start_date IS NOT NULL OR a.end_date IS NOT NULL)
           AND (a.start_date IS NULL OR a.start_date < DATE_ADD(?, INTERVAL 7 DAY))
           AND (a.end_date IS NULL OR a.end_date >= ?)`,
        [user.id, weekStartDate, weekStartDate],
      );
      let activityConflict: { categoryName: string; title: string; dayIndex: number; existingTime: string; proposedTime: string } | null = null;
      for (let dayIndex = 0; dayIndex < grid.length && !activityConflict; dayIndex += 1) {
        const dateKey = getWeekDate(weekStartDate as string, dayIndex);
        for (let sessionIndex = 0; sessionIndex < grid[dayIndex].length && !activityConflict; sessionIndex += 1) {
          const [proposedStart, proposedEnd] = getSessionTimeRange(startTime as string, endTime as string, sessionIndex).split("–");
          const existing = timedActivities.find((activity) => {
            if ((activity.startDate && activity.startDate > dateKey) || (activity.endDate && activity.endDate < dateKey)) return false;
            return rangesOverlap(toMinutes(proposedStart), toMinutes(proposedEnd), toMinutes(activity.startTime), toMinutes(activity.endTime));
          });
          if (existing) activityConflict = { categoryName: existing.categoryName, title: existing.title, dayIndex, existingTime: existing.startTime + "–" + existing.endTime, proposedTime: proposedStart + "–" + proposedEnd };
        }
      }
      if (activityConflict) {
        await connection.rollback();
        return Response.json({
          error: `จัดตารางไม่ได้ เนื่องจาก${DAY_LABELS[activityConflict.dayIndex]}มี “${activityConflict.title}” ในหมวด “${activityConflict.categoryName}” เวลา ${activityConflict.existingTime} อยู่แล้ว (เวลาที่ชน: ${activityConflict.proposedTime}) กรุณาปรับเวลาก่อนสร้างตาราง`,
        }, { status: 409 });
      }

      const [insertResult] = await connection.execute<ResultSetHeader>(
        "INSERT INTO schedules (user_id, category_id, week_start_date, days_per_week, sessions_per_day, start_time, end_time) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
          user.id,
          category.id,
          weekStartDate,
          daysPerWeek as number,
          sessionsPerDay,
          startTime,
          endTime,
        ],
      );

      const savedSessions: Array<{
        id: number;
        dayIndex: number;
        sessionIndex: number;
        subjectKey: string;
        isCompleted: boolean;
        futureNote: string;
        lectureNotes: string;
      }> = [];
      for (const [dayIndex, day] of grid.entries()) {
        for (const [sessionIndex, subjectKey] of day.entries()) {
          const completionKey = `${dayIndex}:${sessionIndex}:${subjectKey}`;
          const isCompleted = completedSessionKeys.has(completionKey);
          const notes = previousSessionNotes.get(completionKey) ?? {
            futureNote: "",
            lectureNotes: "",
          };
          const [sessionResult] = await connection.execute<ResultSetHeader>(
            "INSERT INTO study_sessions (schedule_id, day_index, session_index, subject_key, is_completed, future_note, lecture_notes) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [
              insertResult.insertId,
              dayIndex,
              sessionIndex,
              subjectKey,
              isCompleted ? 1 : 0,
              notes.futureNote,
              notes.lectureNotes,
            ],
          );
          savedSessions.push({
            id: sessionResult.insertId,
            dayIndex,
            sessionIndex,
            subjectKey,
            isCompleted,
            futureNote: notes.futureNote,
            lectureNotes: notes.lectureNotes,
          });
        }
      }
      await connection.execute(
        "INSERT INTO study_schedule_events (user_id, category_id, schedule_id, event_type, details) VALUES (?, ?, ?, ?, ?)",
        [
          user.id,
          category.id,
          insertResult.insertId,
          "ga_generated",
          JSON.stringify({
            daysPerWeek,
            startTime,
            sessionCount: savedSessions.length,
            subjects: subjects.map((subject) => subject.key),
          }),
        ],
      );
      await connection.commit();

      const updatedSubjects = await getUserSubjectLists(
        pool,
        user.id,
        category.id,
        weekStartDate,
      );
      return Response.json({
        subjects,
        availableSubjects: updatedSubjects.availableSubjects,
        schedule: {
          id: insertResult.insertId,
          weekStartDate,
          daysPerWeek,
          sessionsPerDay,
          startTime,
          endTime,
          createdAt: new Date().toISOString(),
          sessions: savedSessions,
        },
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    return respondWithError(error);
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    const pool = getPool();
    await ensureDatabase(pool);
    const user = await getSessionUser(request, pool);
    if (!user)
      return Response.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });

    const body: unknown = await request.json();
    if (!body || typeof body !== "object") {
      return Response.json(
        { error: "ข้อมูลสถานะอ่านไม่ถูกต้อง" },
        { status: 400 },
      );
    }
    const input = body as Record<string, unknown>;
    const categoryId = Number(input.categoryId);
    const scheduleId = Number(input.scheduleId);
    const sessionId = Number(input.sessionId);
    const action =
      input.action === "notes" || input.action === "subject"
        ? input.action
        : "completion";
    if (
      !Number.isSafeInteger(categoryId) ||
      !Number.isSafeInteger(scheduleId) ||
      !Number.isSafeInteger(sessionId) ||
      (action === "completion" && typeof input.isCompleted !== "boolean") ||
      (action === "subject" && typeof input.subjectKey !== "string") ||
      (action === "notes" &&
        (typeof input.futureNote !== "string" ||
          typeof input.lectureNotes !== "string")) ||
      (action === "notes" &&
        (String(input.futureNote).length > 10000 ||
          String(input.lectureNotes).length > 10000))
    ) {
      return Response.json(
        { error: "ข้อมูลช่วงอ่านไม่ถูกต้อง" },
        { status: 400 },
      );
    }
    const category = await getOwnedCategory(pool, user.id, categoryId);
    if (!category)
      return Response.json({ error: "ไม่พบหมวดนี้" }, { status: 404 });
    const [sessions] = await pool.execute<RowDataPacket[]>(
      "SELECT study_sessions.id, study_sessions.day_index, study_sessions.session_index, study_sessions.subject_key, DATE_FORMAT(schedules.week_start_date, '%Y-%m-%d') AS weekStartDate FROM study_sessions INNER JOIN schedules ON schedules.id = study_sessions.schedule_id WHERE study_sessions.id = ? AND schedules.id = ? AND schedules.user_id = ? AND schedules.category_id = ? LIMIT 1",
      [sessionId, scheduleId, user.id, category.id],
    );
    if (!sessions[0])
      return Response.json({ error: "ไม่พบช่วงอ่านนี้" }, { status: 404 });

    if (action === "notes") {
      await pool.execute(
        "UPDATE study_sessions SET future_note = ?, lecture_notes = ? WHERE id = ?",
        [input.futureNote as string, input.lectureNotes as string, sessionId],
      );
      return Response.json({
        sessionId,
        futureNote: input.futureNote,
        lectureNotes: input.lectureNotes,
      });
    }

    if (action === "subject") {
      const weekSubjectLists = await getUserSubjectLists(
        pool,
        user.id,
        category.id,
        String(sessions[0].weekStartDate).slice(0, 10),
      );
      const currentSessionIsWeekScoped = weekSubjectLists.subjects.some(
        (subject) => subject.key === String(sessions[0].subject_key),
      );
      const subjects = currentSessionIsWeekScoped
        ? weekSubjectLists.subjects
        : (await getUserSubjectLists(pool, user.id, category.id, null)).subjects;
      const nextSubjectKey = input.subjectKey as string;
      if (!subjects.some((subject) => subject.key === nextSubjectKey)) {
        return Response.json(
          { error: "เลือกวิชาหรือกิจกรรมที่อยู่ในหมวดนี้เท่านั้น" },
          { status: 400 },
        );
      }
      await pool.execute(
        "UPDATE study_sessions SET subject_key = ? WHERE id = ?",
        [nextSubjectKey, sessionId],
      );
      await pool.execute(
        "INSERT INTO study_schedule_events (user_id, category_id, schedule_id, event_type, details) VALUES (?, ?, ?, ?, ?)",
        [
          user.id,
          category.id,
          scheduleId,
          "session_customized",
          JSON.stringify({
            sessionId,
            dayIndex: sessions[0].day_index,
            sessionIndex: sessions[0].session_index,
            previousSubjectKey: sessions[0].subject_key,
            subjectKey: nextSubjectKey,
          }),
        ],
      );
      return Response.json({ sessionId, subjectKey: nextSubjectKey });
    }

    await pool.execute(
      "UPDATE study_sessions SET is_completed = ? WHERE id = ?",
      [input.isCompleted ? 1 : 0, sessionId],
    );
    await pool.execute(
      "INSERT INTO study_schedule_events (user_id, category_id, schedule_id, event_type, details) VALUES (?, ?, ?, ?, ?)",
      [
        user.id,
        category.id,
        scheduleId,
        input.isCompleted ? "session_completed" : "session_reopened",
        JSON.stringify({
          sessionId,
          dayIndex: sessions[0].day_index,
          sessionIndex: sessions[0].session_index,
          subjectKey: sessions[0].subject_key,
        }),
      ],
    );
    return Response.json({ sessionId, isCompleted: input.isCompleted });
  } catch (error) {
    return respondWithError(error);
  }
}
