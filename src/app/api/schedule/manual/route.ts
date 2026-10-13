import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { isPriorityWeight } from '@/lib/subjects';
import { getSessionUser } from '@/lib/auth';
import { getOwnedCategory } from '@/lib/categories';
import { ensureDatabase, getPool, getUserSubjectLists } from '@/lib/database';
import { getSessionTimeRange } from '@/lib/study-time';

export const runtime = 'nodejs';

type ManualBlockRow = RowDataPacket & {
  id: number;
  subjectKey: string;
  subjectLabel: string;
  subjectKind: 'subject' | 'activity';
  dayIndex: number;
  scheduledDate?: string | null;
  startTime: string;
  durationMinutes: number;
  blockType: 'study' | 'review' | 'understanding' | 'planning';
  isCompleted: number;
};

type ScheduleRow = RowDataPacket & {
  id: number;
  start_time: string;
  end_time: string;
};

function toMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function rangesOverlap(firstStart: number, firstEnd: number, secondStart: number, secondEnd: number): boolean {
  return firstStart < secondEnd && secondStart < firstEnd;
}

function isValidDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function getDayIndexFromDate(dateKey: string): number {
  return (new Date(dateKey + 'T00:00:00Z').getUTCDay() + 6) % 7;
}

function getWeekStartFromDate(dateKey: string): string {
  const date = new Date(dateKey + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() - getDayIndexFromDate(dateKey));
  return date.toISOString().slice(0, 10);
}

async function getCategory(request: Request, userId: number) {
  const categoryId = Number(new URL(request.url).searchParams.get('categoryId'));
  if (!Number.isSafeInteger(categoryId) || categoryId < 1) return null;
  return getOwnedCategory(getPool(), userId, categoryId);
}

export async function GET(request: Request): Promise<Response> {
  try {
    const pool = getPool();
    await ensureDatabase(pool);
    const user = await getSessionUser(request, pool);
    if (!user) return Response.json({ error: 'กรุณาเข้าสู่ระบบ' }, { status: 401 });
    const category = await getCategory(request, user.id);
    if (!category) return Response.json({ error: 'ไม่พบหมวดนี้' }, { status: 404 });

    const [rows] = await pool.execute<ManualBlockRow[]>(
      "SELECT b.id, b.subject_key AS subjectKey, subjects.label AS subjectLabel, subjects.kind AS subjectKind, b.day_index AS dayIndex, DATE_FORMAT(b.scheduled_date, '%Y-%m-%d') AS scheduledDate, TIME_FORMAT(b.start_time, '%H:%i') AS startTime, b.duration_minutes AS durationMinutes, b.block_type AS blockType, b.is_completed AS isCompleted FROM manual_study_blocks b INNER JOIN subjects ON subjects.subject_key = b.subject_key WHERE b.user_id = ? AND b.category_id = ? ORDER BY COALESCE(b.scheduled_date, DATE_ADD(CURDATE(), INTERVAL b.day_index DAY)), b.day_index, b.start_time",
      [user.id, category.id],
    );
    return Response.json({ blocks: rows.map((row) => ({
      id: row.id,
      subjectKey: row.subjectKey,
      subjectLabel: row.subjectLabel,
      subjectKind: row.subjectKind,
      dayIndex: Number(row.dayIndex),
      scheduledDate: row.scheduledDate ?? null,
      startTime: row.startTime,
      durationMinutes: Number(row.durationMinutes),
      blockType: row.blockType,
      isCompleted: Boolean(row.isCompleted),
    })) });
  } catch (error) {
    console.error('Load manual schedule error:', error instanceof Error ? error.message : 'Unknown error');
    return Response.json({ error: 'โหลดช่วงเรียน manual ไม่สำเร็จ' }, { status: 500 });
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const pool = getPool();
    await ensureDatabase(pool);
    const user = await getSessionUser(request, pool);
    if (!user) return Response.json({ error: 'กรุณาเข้าสู่ระบบ' }, { status: 401 });
    const body: unknown = await request.json();
    if (!body || typeof body !== 'object') return Response.json({ error: 'ข้อมูลช่วงเรียนไม่ถูกต้อง' }, { status: 400 });
    const input = body as Record<string, unknown>;
    const categoryId = Number(input.categoryId);
    const category = Number.isSafeInteger(categoryId) ? await getOwnedCategory(pool, user.id, categoryId) : null;
    const dayIndex = input.dayIndex;
    const rawScheduledDate = input.scheduledDate;
    const scheduledDate =
      rawScheduledDate === undefined || rawScheduledDate === null || rawScheduledDate === ''
        ? null
        : rawScheduledDate;
    const hasSubjectScopeDate = Object.prototype.hasOwnProperty.call(input, 'subjectScopeDate');
    const subjectScopeDate = hasSubjectScopeDate
      ? (typeof input.subjectScopeDate === 'string' && input.subjectScopeDate ? input.subjectScopeDate : null)
      : (typeof scheduledDate === 'string' ? getWeekStartFromDate(scheduledDate) : null);
    const startTime = input.startTime;
    const durationMinutes = input.durationMinutes;
    const blockType = input.blockType;
    const subjectKey = input.subjectKey;
    const weight = input.weight;
    const validBlockTypes = ['study', 'review', 'understanding', 'planning'];
    if (!category) return Response.json({ error: 'ไม่พบหมวดนี้' }, { status: 404 });
    if (typeof subjectKey !== 'string'
      || typeof dayIndex !== 'number' || !Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex > 6
      || (scheduledDate !== null && !isValidDateKey(scheduledDate))
      || (scheduledDate !== null && getDayIndexFromDate(scheduledDate) !== dayIndex)
      || (subjectScopeDate !== null && (!isValidDateKey(subjectScopeDate) || getWeekStartFromDate(subjectScopeDate) !== subjectScopeDate))
      || typeof startTime !== 'string' || !/^(?:[01]\d|2[0-3]):(?:00|15|30|45)$/.test(startTime)
      || typeof durationMinutes !== 'number' || !Number.isInteger(durationMinutes) || durationMinutes < 15
      || durationMinutes > 240 || durationMinutes % 15 !== 0
      || !isPriorityWeight(weight)
      || typeof blockType !== 'string' || !validBlockTypes.includes(blockType)
      || toMinutes(startTime) + durationMinutes > 1440) {
      return Response.json({ error: 'ตรวจวิชา วัน เวลา ระยะเวลา น้ำหนัก และรูปแบบช่วงเรียนอีกครั้ง' }, { status: 400 });
    }
    const { subjects } = await getUserSubjectLists(
      pool,
      user.id,
      category.id,
      subjectScopeDate,
    );
    const selectedItem = subjects.find((subject) => subject.key === subjectKey);
    if (!selectedItem) {
      return Response.json({ error: 'เลือกวิชาหรือกิจกรรมที่อยู่ในหมวดนี้เท่านั้น' }, { status: 400 });
    }

    const start = toMinutes(startTime);
    const end = start + (durationMinutes as number);
    const [manualBlocks] = scheduledDate
      ? await pool.execute<ManualBlockRow[]>(
          "SELECT id, day_index AS dayIndex, TIME_FORMAT(start_time, '%H:%i') AS startTime, duration_minutes AS durationMinutes FROM manual_study_blocks WHERE user_id = ? AND category_id = ? AND (scheduled_date = ? OR (scheduled_date IS NULL AND day_index = ?))",
          [user.id, category.id, scheduledDate, dayIndex],
        )
      : await pool.execute<ManualBlockRow[]>(
          "SELECT id, day_index AS dayIndex, TIME_FORMAT(start_time, '%H:%i') AS startTime, duration_minutes AS durationMinutes FROM manual_study_blocks WHERE user_id = ? AND category_id = ? AND scheduled_date IS NULL AND day_index = ?",
          [user.id, category.id, dayIndex],
        );
    if (manualBlocks.some((block) => rangesOverlap(
      start,
      end,
      toMinutes(block.startTime),
      toMinutes(block.startTime) + Number(block.durationMinutes),
    ))) {
      return Response.json({ error: 'ช่วงเวลานี้ชนกับรายการ manual อื่นในวันเดียวกัน' }, { status: 409 });
    }

    const [schedules] = scheduledDate
      ? await pool.execute<ScheduleRow[]>(
          'SELECT id, start_time, end_time FROM schedules WHERE user_id = ? AND category_id = ? AND week_start_date = ? ORDER BY id DESC LIMIT 1',
          [user.id, category.id, getWeekStartFromDate(scheduledDate)],
        )
      : await pool.execute<ScheduleRow[]>(
          'SELECT id, start_time, end_time FROM schedules WHERE user_id = ? AND category_id = ? ORDER BY id DESC LIMIT 1',
          [user.id, category.id],
        );
    if (schedules[0]) {
      const [sessions] = await pool.execute<RowDataPacket[]>(
        'SELECT day_index, session_index FROM study_sessions WHERE schedule_id = ? AND day_index = ?',
        [schedules[0].id, dayIndex],
      );
      const conflict = sessions.some((session) => {
        const [sessionStart, sessionEnd] = getSessionTimeRange(
          schedules[0].start_time.slice(0, 5),
          schedules[0].end_time.slice(0, 5),
          session.session_index,
        ).split('–');
        return rangesOverlap(start, end, toMinutes(sessionStart), toMinutes(sessionEnd));
      });
      if (conflict) {
        return Response.json({ error: 'ช่วงเวลานี้ชนกับตาราง GA กรุณาเลือกเวลาอื่น' }, { status: 409 });
      }
    }

    if (scheduledDate) {
      const [activities] = await pool.execute<RowDataPacket[]>(
        "SELECT title, TIME_FORMAT(start_time, '%H:%i') AS startTime, TIME_FORMAT(end_time, '%H:%i') AS endTime FROM study_activities WHERE user_id = ? AND category_id = ? AND start_date IS NOT NULL AND start_date <= ? AND (end_date IS NULL OR end_date >= ?) AND start_time IS NOT NULL AND end_time IS NOT NULL",
        [user.id, category.id, scheduledDate, scheduledDate],
      );
      const conflictingActivity = activities.find((activity) =>
        rangesOverlap(start, end, toMinutes(activity.startTime), toMinutes(activity.endTime)),
      );
      if (conflictingActivity) {
        return Response.json(
          { error: `ช่วงเวลานี้ชนกับกิจกรรม "${conflictingActivity.title}" กรุณาเลือกเวลาอื่น` },
          { status: 409 },
        );
      }
    }

    const connection: PoolConnection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      // Weight is attached to the selected study item, including an activity's linked subject.
      await connection.execute(
        'UPDATE subjects SET weight = ? WHERE subject_key = ? AND user_id = ? AND category_id = ?',
        [weight, subjectKey, user.id, category.id],
      );
      await connection.execute(
        'UPDATE user_subject_preferences SET weight = ? WHERE user_id = ? AND subject_key = ? AND is_added = 1',
        [weight, user.id, subjectKey],
      );
      if (selectedItem.kind === 'activity') {
        await connection.execute(
          'UPDATE study_activities SET weight = ? WHERE activity_subject_key = ? AND user_id = ? AND category_id = ?',
          [weight, subjectKey, user.id, category.id],
        );
      }

      const [result] = await connection.execute<ResultSetHeader>(
        'INSERT INTO manual_study_blocks (user_id, category_id, subject_key, day_index, scheduled_date, start_time, duration_minutes, block_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [user.id, category.id, subjectKey, dayIndex, scheduledDate, startTime, durationMinutes, blockType],
      );
      await connection.execute(
        'INSERT INTO study_schedule_events (user_id, category_id, event_type, details) VALUES (?, ?, ?, ?)',
        [user.id, category.id, 'manual_block_added', JSON.stringify({
          blockId: result.insertId,
          subjectKey,
          dayIndex,
          scheduledDate,
          startTime,
          durationMinutes,
          blockType,
          weight,
        })],
      );
      await connection.commit();

      const updatedSubjectLists = await getUserSubjectLists(
        pool,
        user.id,
        category.id,
        subjectScopeDate,
      );
      return Response.json({
        blockId: result.insertId,
        subjects: updatedSubjectLists.subjects,
        availableSubjects: updatedSubjectLists.availableSubjects,
      }, { status: 201 });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Create manual schedule error:', error instanceof Error ? error.message : 'Unknown error');
    return Response.json({ error: 'เพิ่มช่วงเรียน manual ไม่สำเร็จ' }, { status: 500 });
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    const pool = getPool();
    await ensureDatabase(pool);
    const user = await getSessionUser(request, pool);
    if (!user) return Response.json({ error: 'กรุณาเข้าสู่ระบบ' }, { status: 401 });
    const body: unknown = await request.json();
    if (!body || typeof body !== 'object') return Response.json({ error: 'ข้อมูลสถานะช่วงเรียนไม่ถูกต้อง' }, { status: 400 });
    const input = body as Record<string, unknown>;
    const categoryId = Number(input.categoryId);
    const blockId = Number(input.blockId);
    const category = Number.isSafeInteger(categoryId) ? await getOwnedCategory(pool, user.id, categoryId) : null;
    if (!category || !Number.isSafeInteger(blockId) || blockId < 1 || typeof input.isCompleted !== 'boolean') {
      return Response.json({ error: 'ข้อมูลสถานะช่วงเรียนไม่ถูกต้อง' }, { status: 400 });
    }
    const [blocks] = await pool.execute<ManualBlockRow[]>(
      'SELECT id, subject_key AS subjectKey, day_index AS dayIndex, TIME_FORMAT(start_time, \'%H:%i\') AS startTime, duration_minutes AS durationMinutes, block_type AS blockType, is_completed AS isCompleted FROM manual_study_blocks WHERE id = ? AND user_id = ? AND category_id = ? LIMIT 1',
      [blockId, user.id, category.id],
    );
    if (!blocks[0]) return Response.json({ error: 'ไม่พบช่วงเรียนนี้' }, { status: 404 });
    const [result] = await pool.execute<ResultSetHeader>(
      'UPDATE manual_study_blocks SET is_completed = ? WHERE id = ? AND user_id = ? AND category_id = ?',
      [input.isCompleted ? 1 : 0, blockId, user.id, category.id],
    );
    if (!result.affectedRows) return Response.json({ error: 'ไม่พบช่วงเรียนนี้' }, { status: 404 });
    if (Boolean(blocks[0].isCompleted) !== input.isCompleted) {
      await pool.execute(
        'INSERT INTO study_schedule_events (user_id, category_id, event_type, details) VALUES (?, ?, ?, ?)',
        [user.id, category.id, input.isCompleted ? 'manual_block_completed' : 'manual_block_reopened', JSON.stringify({
          blockId,
          subjectKey: blocks[0].subjectKey,
          dayIndex: blocks[0].dayIndex,
          startTime: blocks[0].startTime,
          durationMinutes: blocks[0].durationMinutes,
        })],
      );
    }
    return Response.json({ blockId, isCompleted: input.isCompleted });
  } catch (error) {
    console.error('Update manual schedule error:', error instanceof Error ? error.message : 'Unknown error');
    return Response.json({ error: 'อัปเดตช่วงเรียนไม่สำเร็จ' }, { status: 500 });
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    const pool = getPool();
    await ensureDatabase(pool);
    const user = await getSessionUser(request, pool);
    if (!user) return Response.json({ error: 'กรุณาเข้าสู่ระบบ' }, { status: 401 });
    const body: unknown = await request.json();
    if (!body || typeof body !== 'object') return Response.json({ error: 'เลือกช่วงเรียนที่ต้องการลบ' }, { status: 400 });
    const input = body as Record<string, unknown>;
    const categoryId = Number(input.categoryId);
    const blockId = Number(input.blockId);
    const category = Number.isSafeInteger(categoryId) ? await getOwnedCategory(pool, user.id, categoryId) : null;
    if (!category || !Number.isSafeInteger(blockId) || blockId < 1) {
      return Response.json({ error: 'เลือกช่วงเรียนที่ต้องการลบ' }, { status: 400 });
    }
    const [blocks] = await pool.execute<ManualBlockRow[]>(
      'SELECT id, subject_key AS subjectKey, day_index AS dayIndex, TIME_FORMAT(start_time, \'%H:%i\') AS startTime, duration_minutes AS durationMinutes, block_type AS blockType, is_completed AS isCompleted FROM manual_study_blocks WHERE id = ? AND user_id = ? AND category_id = ? LIMIT 1',
      [blockId, user.id, category.id],
    );
    if (!blocks[0]) return Response.json({ error: 'ไม่พบช่วงเรียนนี้' }, { status: 404 });
    const [result] = await pool.execute<ResultSetHeader>(
      'DELETE FROM manual_study_blocks WHERE id = ? AND user_id = ? AND category_id = ?',
      [blockId, user.id, category.id],
    );
    if (!result.affectedRows) return Response.json({ error: 'ไม่พบช่วงเรียนนี้' }, { status: 404 });
    await pool.execute(
      'INSERT INTO study_schedule_events (user_id, category_id, event_type, details) VALUES (?, ?, ?, ?)',
      [user.id, category.id, 'manual_block_removed', JSON.stringify({
        blockId,
        subjectKey: blocks[0].subjectKey,
        dayIndex: blocks[0].dayIndex,
        startTime: blocks[0].startTime,
        durationMinutes: blocks[0].durationMinutes,
        blockType: blocks[0].blockType,
        wasCompleted: Boolean(blocks[0].isCompleted),
      })],
    );
    return Response.json({ blockId });
  } catch (error) {
    console.error('Delete manual schedule error:', error instanceof Error ? error.message : 'Unknown error');
    return Response.json({ error: 'ลบช่วงเรียนไม่สำเร็จ' }, { status: 500 });
  }
}