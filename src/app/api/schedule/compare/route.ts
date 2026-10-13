import type { RowDataPacket } from "mysql2/promise";
import type { SubjectPreference } from "@/lib/subjects";
import { getOwnedCategory } from "@/lib/categories";
import { getSessionUser } from "@/lib/auth";
import {
  ensureDatabase,
  getPool,
  getUserSubjectLists,
} from "@/lib/database";
import { compareStudyAlgorithms } from "@/lib/genetic-algorithm";
import {
  getSessionTimeRange,
  getStudySessionsPerDay,
  isValidStudyEndTime,
  isValidStudyStartTime,
} from "@/lib/study-time";
import { isPriorityWeight, type PriorityWeight } from "@/lib/subjects";

export const runtime = "nodejs";

type ManualBlockRow = RowDataPacket & {
  dayIndex: number;
  startTime: string;
  durationMinutes: number;
};

function toMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function rangesOverlap(
  firstStart: number,
  firstEnd: number,
  secondStart: number,
  secondEnd: number,
): boolean {
  return firstStart < secondEnd && secondStart < firstEnd;
}

function isValidWeekStartDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00Z");
  const [year, month, day] = value.split("-").map(Number);
  return date.getUTCFullYear() === year
    && date.getUTCMonth() + 1 === month
    && date.getUTCDate() === day
    && date.getUTCDay() === 1;
}

export async function POST(request: Request): Promise<Response> {
  try {
    const pool = getPool();
    await ensureDatabase(pool);
    const user = await getSessionUser(request, pool);
    if (!user) {
      return Response.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
    }

    const body: unknown = await request.json();
    if (!body || typeof body !== "object") {
      return Response.json({ error: "ข้อมูลตั้งค่าไม่ถูกต้อง" }, { status: 400 });
    }

    const input = body as Record<string, unknown>;
    const categoryId = Number(input.categoryId);
    const category =
      Number.isSafeInteger(categoryId) && categoryId > 0
        ? await getOwnedCategory(pool, user.id, categoryId)
        : null;
    if (!category) {
      return Response.json(
        { error: "กรุณาเลือกหมวดที่เป็นของบัญชีคุณ" },
        { status: 400 },
      );
    }

    const daysPerWeek = input.daysPerWeek;
    const startTime = input.startTime;
    const endTime = input.endTime;
    const weekStartDate = input.weekStartDate ?? null;
    if (weekStartDate !== null && !isValidWeekStartDate(weekStartDate)) {
      return Response.json({ error: "สัปดาห์ไม่ถูกต้อง ต้องระบุวันจันทร์ในรูปแบบ YYYY-MM-DD" }, { status: 400 });
    }
    if (!Number.isInteger(daysPerWeek) || Number(daysPerWeek) < 1 || Number(daysPerWeek) > 7) {
      return Response.json({ error: "วันอ่านต่อสัปดาห์ต้องอยู่ระหว่าง 1 ถึง 7 วัน" }, { status: 400 });
    }
    if (!isValidStudyStartTime(startTime) || !isValidStudyEndTime(endTime)) {
      return Response.json({ error: "กรุณาเลือกเวลาเริ่มและสิ้นสุดที่ถูกต้อง" }, { status: 400 });
    }
    if (toMinutes(endTime) <= toMinutes(startTime)) {
      return Response.json({ error: "เวลาสิ้นสุดต้องมากกว่าเวลาเริ่มอ่าน" }, { status: 400 });
    }

    const submittedSubjects = input.subjects;
    if (!Array.isArray(submittedSubjects) || submittedSubjects.length < 1 || submittedSubjects.length > 50) {
      return Response.json({ error: "ต้องมีรายวิชาสำหรับเปรียบเทียบอย่างน้อย 1 วิชา" }, { status: 400 });
    }

    const { subjects: ownedSubjects } = await getUserSubjectLists(
      pool,
      user.id,
      category.id,
      weekStartDate as string | null,
    );
    const eligibleSubjects = ownedSubjects.filter((subject) => subject.kind === "subject");
    const ownedByKey = new Map(eligibleSubjects.map((subject) => [subject.key, subject]));
    const submitted = submittedSubjects as Array<Partial<SubjectPreference>>;
    const submittedKeys = submitted.map((subject) => subject?.key);
    const validSubjects =
      new Set(submittedKeys).size === submitted.length &&
      submitted.every((subject) =>
        typeof subject.key === "string" &&
        ownedByKey.has(subject.key) &&
        isPriorityWeight(subject.weight),
      );
    if (!validSubjects) {
      return Response.json(
        { error: "ข้อมูลรายวิชาไม่ถูกต้อง กรุณาตรวจสอบวิชาและ Weight อีกครั้ง" },
        { status: 400 },
      );
    }

    const subjects: SubjectPreference[] = submitted.map((subject) => ({
      ...ownedByKey.get(subject.key!)!,
      weight: subject.weight as PriorityWeight,
    }));
    const totalWeight = subjects.reduce((sum, subject) => sum + Number(subject.weight), 0);
    if (totalWeight !== 100) {
      return Response.json(
        { error: `Weight ของวิชาที่นำมาเปรียบเทียบต้องรวมเป็น 100% (ปัจจุบัน ${totalWeight}%)` },
        { status: 400 },
      );
    }

    const sessionsPerDay = getStudySessionsPerDay(startTime, endTime);
    const [manualBlocks] = await pool.execute<ManualBlockRow[]>(
      "SELECT day_index AS dayIndex, TIME_FORMAT(start_time, '%H:%i') AS startTime, duration_minutes AS durationMinutes FROM manual_study_blocks WHERE user_id = ? AND category_id = ? AND (scheduled_date IS NULL OR (scheduled_date >= ? AND scheduled_date < DATE_ADD(?, INTERVAL 7 DAY)))",
      [user.id, category.id, weekStartDate ?? "1000-01-01", weekStartDate ?? "1000-01-01"],
    );
    const hasManualConflict = manualBlocks.some((block) => {
      if (Number(block.dayIndex) >= Number(daysPerWeek)) return false;
      for (let sessionIndex = 0; sessionIndex < sessionsPerDay; sessionIndex += 1) {
        const [sessionStart, sessionEnd] = getSessionTimeRange(
          startTime,
          endTime,
          sessionIndex,
        ).split("–");
        if (
          rangesOverlap(
            toMinutes(block.startTime),
            toMinutes(block.startTime) + Number(block.durationMinutes),
            toMinutes(sessionStart),
            toMinutes(sessionEnd),
          )
        ) {
          return true;
        }
      }
      return false;
    });
    if (hasManualConflict) {
      return Response.json(
        {
          error:
            "เปรียบเทียบไม่ได้ เพราะช่วงเรียนเองชนกับช่วงเวลาในตารางอัตโนมัติ กรุณาย้ายหรือลบช่วงเรียนเองที่ชนก่อน",
        },
        { status: 409 },
      );
    }

    const comparison = compareStudyAlgorithms(
      subjects,
      daysPerWeek as number,
      sessionsPerDay,
      {
        runs: 5,
        seed: JSON.stringify({
          userId: user.id,
          categoryId: category.id,
          daysPerWeek,
          startTime,
          endTime,
          subjects: subjects.map((subject) => [subject.key, subject.weight]),
        }),
      },
    );
    return Response.json({
      comparison,
      settings: { daysPerWeek, sessionsPerDay, startTime, endTime },
    });
  } catch (error) {
    console.error(
      "Schedule algorithm comparison error:",
      error instanceof Error ? error.message : "Unknown error",
    );
    return Response.json(
      { error: error instanceof Error ? error.message : "เปรียบเทียบอัลกอริทึมไม่สำเร็จ" },
      { status: 500 },
    );
  }
}
