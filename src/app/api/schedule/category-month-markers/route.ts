import type { RowDataPacket } from "mysql2/promise";
import { getSessionUser } from "@/lib/auth";
import { getOwnedCategory } from "@/lib/categories";
import { ensureDatabase, getPool } from "@/lib/database";

export const runtime = "nodejs";

type MonthMarkRow = RowDataPacket & {
  categoryId: number;
  categoryName: string;
  weekStartDate: string;
  dayIndex: number;
};

type MonthlyCategoryMark = {
  categoryId: number;
  categoryName: string;
  dateKey: string;
};

function isMondayDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00Z");
  const [year, month, day] = value.split("-").map(Number);
  return date.getUTCFullYear() === year
    && date.getUTCMonth() + 1 === month
    && date.getUTCDate() === day
    && date.getUTCDay() === 1;
}

export async function GET(request: Request): Promise<Response> {
  try {
    const pool = getPool();
    await ensureDatabase(pool);

    const user = await getSessionUser(request, pool);
    if (!user) return Response.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });

    const params = new URL(request.url).searchParams;
    const categoryId = Number(params.get("categoryId"));
    const startDate = params.get("startDate");

    if (!Number.isSafeInteger(categoryId) || categoryId < 1) {
      return Response.json({ error: "กรุณาเลือกหมวดแผนที่ถูกต้อง" }, { status: 400 });
    }
    if (!isMondayDate(startDate)) {
      return Response.json({ error: "วันที่เริ่มปฏิทินต้องเป็นวันจันทร์ในรูปแบบ YYYY-MM-DD" }, { status: 400 });
    }

    const category = await getOwnedCategory(pool, user.id, categoryId);
    if (!category) return Response.json({ error: "ไม่พบหมวดนี้" }, { status: 404 });

    const [rows] = await pool.execute<MonthMarkRow[]>(
      `SELECT c.id AS categoryId, c.name AS categoryName,
              DATE_FORMAT(s.week_start_date, '%Y-%m-%d') AS weekStartDate,
              ss.day_index AS dayIndex
       FROM schedules s
       INNER JOIN study_categories c ON c.id = s.category_id AND c.user_id = s.user_id
       INNER JOIN study_sessions ss ON ss.schedule_id = s.id
       WHERE s.user_id = ? AND s.category_id <> ?
         AND s.week_start_date >= ?
         AND s.week_start_date <= DATE_ADD(?, INTERVAL 35 DAY)
         AND s.id = (
           SELECT MAX(s2.id) FROM schedules s2
           WHERE s2.user_id = s.user_id
             AND s2.category_id = s.category_id
             AND s2.week_start_date = s.week_start_date
         )
       ORDER BY c.id, s.week_start_date, ss.day_index`,
      [user.id, category.id, startDate, startDate],
    );

    const endDate = new Date(startDate + "T00:00:00Z");
    endDate.setUTCDate(endDate.getUTCDate() + 41);
    const endDateKey = endDate.toISOString().slice(0, 10);
    const marksByCategoryAndDate = new Map<string, MonthlyCategoryMark>();

    for (const row of rows) {
      const date = new Date(row.weekStartDate + "T00:00:00Z");
      date.setUTCDate(date.getUTCDate() + Number(row.dayIndex));
      const dateKey = date.toISOString().slice(0, 10);
      if (dateKey < startDate || dateKey > endDateKey) continue;

      const normalizedCategoryId = Number(row.categoryId);
      const key = normalizedCategoryId + ":" + dateKey;
      marksByCategoryAndDate.set(key, {
        categoryId: normalizedCategoryId,
        categoryName: row.categoryName,
        dateKey,
      });
    }

    return Response.json({ startDate, marks: Array.from(marksByCategoryAndDate.values()) });
  } catch (error) {
    console.error("Load monthly category markers error:", error instanceof Error ? error.message : "Unknown error");
    return Response.json({ error: "โหลดจุดตารางจากหมวดอื่นไม่สำเร็จ" }, { status: 500 });
  }
}
