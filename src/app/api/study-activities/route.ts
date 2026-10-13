import { randomBytes } from 'node:crypto';
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { getSessionUser } from '@/lib/auth';
import { getOwnedCategory } from '@/lib/categories';
import { ensureDatabase, getPool, getUserSubjectLists } from '@/lib/database';
import { isPriorityWeight } from '@/lib/subjects';

export const runtime = 'nodejs';
const activityTypes = ['study', 'homework', 'project', 'review'] as const;
type ActivityType = typeof activityTypes[number];

function validDate(value: string | null): boolean {
  return value === null || /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function validTime(value: string | null): boolean {
  return value === null || /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function validWeekStartDate(value: string | null): boolean {
  if (value === null) return true;
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  const [year, month, day] = value.split('-').map(Number);
  return date.getUTCFullYear() === year
    && date.getUTCMonth() + 1 === month
    && date.getUTCDate() === day
    && date.getUTCDay() === 1;
}

type ActivityRow = RowDataPacket & {
  id: number;
  subjectKey: string | null;
  futureNote: string | null;
  lectureNotes: string | null;
  activityType: ActivityType | null;
  courseKey: string | null;
  title: string;
  details: string | null;
  weight: number;
  durationHours: number;
  startDate: string | null;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
  isCompleted: number;
};

export async function GET(request: Request): Promise<Response> {
  try {
    const pool = getPool();
    await ensureDatabase(pool);
    const user = await getSessionUser(request, pool);
    if (!user) return Response.json({ error: 'กรุณาเข้าสู่ระบบ' }, { status: 401 });

    const searchParams = new URL(request.url).searchParams;
    const categoryId = Number(searchParams.get('categoryId'));
    const rawScheduleOnlyDate = searchParams.get('scheduleOnlyDate');
    const scheduleOnlyDate = rawScheduleOnlyDate || null;
    if (!validWeekStartDate(scheduleOnlyDate)) {
      return Response.json({ error: 'สัปดาห์ของชุดตารางไม่ถูกต้อง' }, { status: 400 });
    }
    if (!Number.isSafeInteger(categoryId) || categoryId < 1
      || !(await getOwnedCategory(pool, user.id, categoryId))) {
      return Response.json({ error: 'กรุณาเลือกหมวดที่เป็นของบัญชีคุณ' }, { status: 400 });
    }

    const [rows] = await pool.execute<ActivityRow[]>(
      `SELECT a.id, a.activity_subject_key AS subjectKey,
              COALESCE(linked_subject.future_note, '') AS futureNote,
              COALESCE(linked_subject.lecture_notes, '') AS lectureNotes,
              a.activity_type AS activityType, a.course_key AS courseKey,
              a.title, a.details, a.weight, a.duration_hours AS durationHours,
              DATE_FORMAT(start_date, '%Y-%m-%d') AS startDate,
              DATE_FORMAT(end_date, '%Y-%m-%d') AS endDate,
              TIME_FORMAT(start_time, '%H:%i') AS startTime,
              TIME_FORMAT(end_time, '%H:%i') AS endTime,
              a.is_completed AS isCompleted
       FROM study_activities a
       LEFT JOIN subjects linked_subject ON linked_subject.subject_key = a.activity_subject_key
         AND linked_subject.user_id = a.user_id AND linked_subject.category_id = a.category_id
       WHERE a.user_id = ? AND a.category_id = ?
       ORDER BY a.start_date IS NULL, a.start_date, a.start_time IS NULL, a.start_time, a.id`,
      [user.id, categoryId],
    );

    const { subjects, availableSubjects } = await getUserSubjectLists(
      pool,
      user.id,
      categoryId,
      scheduleOnlyDate,
    );
    const courses = [...subjects, ...availableSubjects]
      .filter((subject) => subject.kind === 'subject')
      .filter((subject, index, list) => list.findIndex((item) => item.key === subject.key) === index)
      .map((subject) => ({ key: subject.key, label: subject.label }));

    return Response.json({
      activities: rows.map((row) => ({
        id: Number(row.id),
        subjectKey: row.subjectKey,
        futureNote: row.futureNote ?? '',
        lectureNotes: row.lectureNotes ?? '',
        activityType: row.activityType,
        courseKey: row.courseKey,
        title: row.title,
        details: row.details ?? '',
        weight: Number(row.weight),
        durationHours: Number(row.durationHours),
        startDate: row.startDate,
        endDate: row.endDate,
        startTime: row.startTime,
        endTime: row.endTime,
        isCompleted: Boolean(row.isCompleted),
      })),
      courses,
    });
  } catch (error) {
    console.error('Get study activities error:', error instanceof Error ? error.message : 'Unknown error');
    return Response.json({ error: 'โหลดกิจกรรมไม่สำเร็จ ตรวจสอบการเชื่อมต่อฐานข้อมูล' }, { status: 500 });
  }
}

export async function DELETE(request: Request): Promise<Response> {
  let connection: PoolConnection | undefined;
  let transactionStarted = false;
  try {
    const pool = getPool();
    await ensureDatabase(pool);
    const user = await getSessionUser(request, pool);
    if (!user) return Response.json({ error: 'กรุณาเข้าสู่ระบบ' }, { status: 401 });

    const params = new URL(request.url).searchParams;
    const categoryId = Number(params.get('categoryId'));
    const activityId = Number(params.get('activityId'));
    const subjectKey = params.get('subjectKey');
    const scheduleOnlyDate = params.get('scheduleOnlyDate') || null;
    if (!validWeekStartDate(scheduleOnlyDate)) {
      return Response.json({ error: 'สัปดาห์ของชุดตารางไม่ถูกต้อง' }, { status: 400 });
    }
    if (!Number.isSafeInteger(categoryId) || categoryId < 1
      || !(await getOwnedCategory(pool, user.id, categoryId))) {
      return Response.json({ error: 'กรุณาเลือกหมวดที่เป็นของบัญชีคุณ' }, { status: 400 });
    }
    if ((!Number.isSafeInteger(activityId) || activityId < 1) && !subjectKey) {
      return Response.json({ error: 'ไม่พบกิจกรรมที่ต้องการลบ' }, { status: 400 });
    }

    connection = await pool.getConnection();
    await connection.beginTransaction();
    transactionStarted = true;

    let activity: { id: number; subjectKey: string | null } | undefined;
    if (Number.isSafeInteger(activityId) && activityId > 0) {
      const [rows] = await connection.execute<Array<RowDataPacket & { id: number; subjectKey: string | null }>>(
        'SELECT id, activity_subject_key AS subjectKey FROM study_activities WHERE id = ? AND user_id = ? AND category_id = ? LIMIT 1',
        [activityId, user.id, categoryId],
      );
      if (rows[0]) activity = { id: Number(rows[0].id), subjectKey: rows[0].subjectKey };
    } else if (subjectKey) {
      const [rows] = await connection.execute<Array<RowDataPacket & { id: number; subjectKey: string | null }>>(
        'SELECT id, activity_subject_key AS subjectKey FROM study_activities WHERE activity_subject_key = ? AND user_id = ? AND category_id = ? LIMIT 1',
        [subjectKey, user.id, categoryId],
      );
      if (rows[0]) activity = { id: Number(rows[0].id), subjectKey: rows[0].subjectKey };
    }

    const activitySubjectKey = activity?.subjectKey ?? subjectKey;
    if (!activity && activitySubjectKey) {
      const [subjectRows] = await connection.execute<RowDataPacket[]>(
        "SELECT subject_key FROM subjects WHERE subject_key = ? AND user_id = ? AND category_id = ? AND kind = 'activity' LIMIT 1",
        [activitySubjectKey, user.id, categoryId],
      );
      if (subjectRows[0]) activity = { id: 0, subjectKey: activitySubjectKey };
    }
    if (!activity) {
      await connection.rollback();
      transactionStarted = false;
      return Response.json({ error: 'ไม่พบกิจกรรมนี้' }, { status: 404 });
    }

    if (activity.subjectKey) {
      await connection.execute(
        'DELETE FROM study_sessions WHERE subject_key = ?',
        [activity.subjectKey],
      );
      await connection.execute(
        'DELETE FROM user_subject_preferences WHERE user_id = ? AND subject_key = ?',
        [user.id, activity.subjectKey],
      );
    }
    if (activity.id > 0) {
      await connection.execute(
        'DELETE FROM study_activities WHERE id = ? AND user_id = ? AND category_id = ?',
        [activity.id, user.id, categoryId],
      );
    }
    if (activity.subjectKey) {
      await connection.execute(
        "DELETE FROM subjects WHERE subject_key = ? AND user_id = ? AND category_id = ? AND kind = 'activity'",
        [activity.subjectKey, user.id, categoryId],
      );
    }

    const { subjects, availableSubjects } = await getUserSubjectLists(
      connection,
      user.id,
      categoryId,
      scheduleOnlyDate,
    );
    await connection.commit();
    transactionStarted = false;
    return Response.json({ deleted: true, subjectKey: activity.subjectKey, subjects, availableSubjects });
  } catch (error) {
    if (connection && transactionStarted) {
      try {
        await connection.rollback();
      } catch {
        console.error('Delete study activity rollback failed');
      }
    }
    console.error('Delete study activity error:', error instanceof Error ? error.message : 'Unknown error');
    return Response.json({ error: 'ลบกิจกรรมไม่สำเร็จ ตรวจสอบการเชื่อมต่อฐานข้อมูล' }, { status: 500 });
  } finally {
    connection?.release();
  }
}

export async function POST(request: Request): Promise<Response> {
  let connection: PoolConnection | undefined;
  let transactionStarted = false;
  try {
    const pool = getPool();
    await ensureDatabase(pool);
    const user = await getSessionUser(request, pool);
    if (!user) return Response.json({ error: 'กรุณาเข้าสู่ระบบ' }, { status: 401 });

    const body: unknown = await request.json();
    if (!body || typeof body !== 'object') {
      return Response.json({ error: 'ข้อมูลกิจกรรมไม่ถูกต้อง' }, { status: 400 });
    }

    const input = body as Record<string, unknown>;
    const categoryId = Number(input.categoryId);
    const rawScheduleOnlyDate = input.scheduleOnlyDate;
    const scheduleOnlyDate =
      typeof rawScheduleOnlyDate === 'string' && rawScheduleOnlyDate
        ? rawScheduleOnlyDate
        : null;
    if (rawScheduleOnlyDate !== undefined && rawScheduleOnlyDate !== null
      && rawScheduleOnlyDate !== '' && !validWeekStartDate(scheduleOnlyDate)) {
      return Response.json({ error: 'สัปดาห์ของชุดตารางไม่ถูกต้อง' }, { status: 400 });
    }
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    const details = typeof input.details === 'string' ? input.details.trim() : '';
    const activityType = activityTypes.find((type) => type === input.activityType);
    const courseKey = typeof input.courseKey === 'string' && input.courseKey ? input.courseKey : null;
    const weight = input.weight;
    const durationHours = Number(input.durationHours);
    const startDate = typeof input.startDate === 'string' && input.startDate ? input.startDate : null;
    const endDate = typeof input.endDate === 'string' && input.endDate ? input.endDate : null;
    const startTime = typeof input.startTime === 'string' && input.startTime ? input.startTime : null;
    const endTime = typeof input.endTime === 'string' && input.endTime ? input.endTime : null;

    if (!Number.isSafeInteger(categoryId) || categoryId < 1
      || !(await getOwnedCategory(pool, user.id, categoryId))) {
      return Response.json({ error: 'กรุณาเลือกหมวดที่เป็นของบัญชีคุณ' }, { status: 400 });
    }
    if (title.length < 1 || title.length > 100 || details.length > 1000
      || !activityType
      || !isPriorityWeight(weight)
      || !Number.isFinite(durationHours) || durationHours < 0.25 || durationHours > 24
      || !validDate(startDate) || !validDate(endDate)
      || !validTime(startTime) || !validTime(endTime)) {
      return Response.json({ error: 'ข้อมูลกิจกรรมไม่ถูกต้อง ตรวจรายละเอียด เวลา และวันที่อีกครั้ง' }, { status: 400 });
    }
    if (startDate && endDate && startDate > endDate) {
      return Response.json({ error: 'วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด' }, { status: 400 });
    }
    if (startTime && endTime && startTime >= endTime) {
      return Response.json({ error: 'เวลาเริ่มต้องก่อนเวลาสิ้นสุด' }, { status: 400 });
    }

    if (courseKey) {
      const [courseRows] = await pool.execute<RowDataPacket[]>(
        'SELECT subject_key FROM subjects WHERE subject_key = ? AND kind = ? AND user_id = ? AND category_id = ? AND schedule_only_date <=> ? LIMIT 1',
        [courseKey, 'subject', user.id, categoryId, scheduleOnlyDate],
      );
      if (!courseRows[0]) return Response.json({ error: 'ไม่พบรายวิชาที่ผูกกับกิจกรรม' }, { status: 400 });
    }

    connection = await pool.getConnection();
    await connection.beginTransaction();
    transactionStarted = true;

    const [counts] = await connection.execute<RowDataPacket[]>(
      'SELECT COUNT(*) AS item_count FROM subjects WHERE user_id = ? AND category_id = ? AND schedule_only_date <=> ?',
      [user.id, categoryId, scheduleOnlyDate],
    );
    if (Number(counts[0]?.item_count ?? 0) >= 50) {
      await connection.rollback();
      transactionStarted = false;
      return Response.json({ error: 'เพิ่มรายการกำหนดเองได้สูงสุด 50 รายการ' }, { status: 400 });
    }

    const [result] = await connection.execute<ResultSetHeader>(
      'INSERT INTO study_activities (user_id, category_id, activity_type, course_key, title, details, weight, duration_hours, start_date, end_date, start_time, end_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [user.id, categoryId, activityType, courseKey, title, details || null, weight, durationHours, startDate, endDate, startTime, endTime],
    );
    const activityId = Number(result.insertId);

    const subjectKey = `custom_${randomBytes(12).toString('hex')}`;
    await connection.execute(
      'INSERT INTO subjects (subject_key, user_id, category_id, kind, label, color, weight, manual_only, schedule_only_date, activity_details, activity_duration_hours, activity_start_date, activity_end_date, activity_start_time, activity_end_time, activity_course_key, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [subjectKey, user.id, categoryId, 'activity', title, '#bd7950', weight,
        scheduleOnlyDate ? 1 : 0, scheduleOnlyDate,
        details || null, durationHours, startDate, endDate, startTime, endTime, courseKey, 100],
    );
    await connection.execute(
      'INSERT INTO user_subject_preferences (user_id, subject_key, weight, is_added) VALUES (?, ?, ?, 1)',
      [user.id, subjectKey, weight],
    );
    await connection.execute(
      'UPDATE study_activities SET activity_subject_key = ? WHERE id = ? AND user_id = ? AND category_id = ?',
      [subjectKey, activityId, user.id, categoryId],
    );

    const subjectLists = await getUserSubjectLists(
      connection,
      user.id,
      categoryId,
      scheduleOnlyDate,
    );
    const courses = [...subjectLists.subjects, ...subjectLists.availableSubjects]
      .filter((subject) => subject.kind === 'subject')
      .filter((subject, index, list) => list.findIndex((item) => item.key === subject.key) === index)
      .map((subject) => ({ key: subject.key, label: subject.label }));
    await connection.commit();
    transactionStarted = false;

    return Response.json({
      activity: {
        id: activityId,
        subjectKey,
        futureNote: '',
        lectureNotes: '',
        activityType,
        courseKey,
        title,
        details,
        weight: Number(weight),
        durationHours,
        startDate,
        endDate,
        startTime,
        endTime,
        isCompleted: false,
      },
      subjects: subjectLists.subjects,
      availableSubjects: subjectLists.availableSubjects,
      courses,
    }, { status: 201 });
  } catch (error) {
    if (connection && transactionStarted) {
      try {
        await connection.rollback();
      } catch {
        console.error('Add study activity rollback failed');
      }
    }
    console.error('Add study activity error:', error instanceof Error ? error.message : 'Unknown error');
    return Response.json({ error: 'เพิ่มกิจกรรมไม่สำเร็จ ตรวจสอบการเชื่อมต่อฐานข้อมูล' }, { status: 500 });
  } finally {
    connection?.release();
  }
}

export async function PATCH(request: Request): Promise<Response> {
  let connection: PoolConnection | undefined;
  let transactionStarted = false;
  try {
    const pool = getPool();
    await ensureDatabase(pool);
    const user = await getSessionUser(request, pool);
    if (!user) return Response.json({ error: 'กรุณาเข้าสู่ระบบ' }, { status: 401 });

    const body: unknown = await request.json();
    if (!body || typeof body !== 'object') {
      return Response.json({ error: 'ข้อมูลกิจกรรมไม่ถูกต้อง' }, { status: 400 });
    }
    const input = body as Record<string, unknown>;
    const activityId = Number(input.activityId);
    const categoryId = Number(input.categoryId);
    const category = Number.isSafeInteger(categoryId) && categoryId > 0
      ? await getOwnedCategory(pool, user.id, categoryId)
      : null;
    if (!category) {
      return Response.json({ error: 'ไม่พบหมวดหมู่' }, { status: 404 });
    }

    // Legacy activity subjects may not have a study_activities row.
    if (input.action === 'completion' && typeof input.subjectKey === 'string' && input.subjectKey.trim()) {
      if (typeof input.isCompleted !== 'boolean') {
        return Response.json({ error: 'สถานะกิจกรรมไม่ถูกต้อง' }, { status: 400 });
      }
      const subjectKey = input.subjectKey.trim();
      const [subjectRows] = await pool.execute<RowDataPacket[]>(
        "SELECT subject_key FROM subjects WHERE subject_key = ? AND user_id = ? AND category_id = ? AND kind = 'activity' LIMIT 1",
        [subjectKey, user.id, category.id],
      );
      if (!subjectRows[0]) {
        return Response.json({ error: 'ไม่พบกิจกรรมนี้' }, { status: 404 });
      }
      await pool.execute(
        "UPDATE subjects SET is_completed = ? WHERE subject_key = ? AND user_id = ? AND category_id = ? AND kind = 'activity'",
        [input.isCompleted ? 1 : 0, subjectKey, user.id, category.id],
      );
      return Response.json({
        activity: { id: 'subject:' + subjectKey, isCompleted: input.isCompleted },
      });
    }

    if (!Number.isSafeInteger(activityId) || activityId < 1) {
      return Response.json({ error: 'ไม่พบกิจกรรมหรือหมวดหมู่' }, { status: 404 });
    }

    const [rows] = await pool.execute<ActivityRow[]>(
      `SELECT a.id, a.activity_subject_key AS subjectKey,
              COALESCE(linked_subject.future_note, '') AS futureNote,
              COALESCE(linked_subject.lecture_notes, '') AS lectureNotes,
              a.course_key AS courseKey, a.title, a.details, a.weight,
              a.duration_hours AS durationHours,
              DATE_FORMAT(start_date, '%Y-%m-%d') AS startDate,
              DATE_FORMAT(end_date, '%Y-%m-%d') AS endDate,
              TIME_FORMAT(start_time, '%H:%i') AS startTime,
              TIME_FORMAT(end_time, '%H:%i') AS endTime,
              a.is_completed AS isCompleted
       FROM study_activities a
       LEFT JOIN subjects linked_subject ON linked_subject.subject_key = a.activity_subject_key
         AND linked_subject.user_id = a.user_id AND linked_subject.category_id = a.category_id
       WHERE a.id = ? AND a.user_id = ? AND a.category_id = ? LIMIT 1`,
      [activityId, user.id, category.id],
    );
    const current = rows[0];
    if (!current) return Response.json({ error: 'ไม่พบกิจกรรมนี้' }, { status: 404 });

    if (input.action === 'completion') {
      if (typeof input.isCompleted !== 'boolean') {
        return Response.json({ error: 'สถานะกิจกรรมไม่ถูกต้อง' }, { status: 400 });
      }
      await pool.execute(
        'UPDATE study_activities SET is_completed = ? WHERE id = ? AND user_id = ? AND category_id = ?',
        [input.isCompleted ? 1 : 0, activityId, user.id, category.id],
      );
      return Response.json({ activity: { id: activityId, isCompleted: input.isCompleted } });
    }

    if (input.action === 'futureNote') {
      const futureNote = typeof input.futureNote === 'string' ? input.futureNote : '';
      if (futureNote.length > 10000) {
        return Response.json({ error: 'Future Note ต้องไม่เกิน 10,000 ตัวอักษร' }, { status: 400 });
      }
      if (!current.subjectKey) {
        return Response.json({ error: 'กิจกรรมนี้ไม่มีวิชาที่เชื่อมไว้' }, { status: 404 });
      }
      const [ownedSubjects] = await pool.execute<RowDataPacket[]>(
        "SELECT subject_key FROM subjects WHERE subject_key = ? AND user_id = ? AND category_id = ? AND kind = 'activity' LIMIT 1",
        [current.subjectKey, user.id, category.id],
      );
      if (!ownedSubjects[0]) return Response.json({ error: 'ไม่พบกิจกรรมที่เชื่อมกับ Future Note' }, { status: 404 });
      await pool.execute(
        "UPDATE subjects SET future_note = ? WHERE subject_key = ? AND user_id = ? AND category_id = ? AND kind = 'activity'",
        [futureNote, current.subjectKey, user.id, category.id],
      );
      return Response.json({ activity: { id: activityId, futureNote } });
    }

    if (input.action !== 'update') {
      return Response.json({ error: 'คำสั่งแก้ไขไม่ถูกต้อง' }, { status: 400 });
    }
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    const details = typeof input.details === 'string' ? input.details.trim() : '';
    const courseKey = typeof input.courseKey === 'string' && input.courseKey ? input.courseKey : null;
    const weight = input.weight;
    const durationHours = Number(input.durationHours);
    const startDate = typeof input.startDate === 'string' && input.startDate ? input.startDate : null;
    const endDate = typeof input.endDate === 'string' && input.endDate ? input.endDate : null;
    const startTime = typeof input.startTime === 'string' && input.startTime ? input.startTime : null;
    const endTime = typeof input.endTime === 'string' && input.endTime ? input.endTime : null;

    if (title.length < 1 || title.length > 100 || details.length > 1000
      || !isPriorityWeight(weight)
      || !Number.isFinite(durationHours) || durationHours < 0.25 || durationHours > 24
      || !validDate(startDate) || !validDate(endDate)
      || !validTime(startTime) || !validTime(endTime)) {
      return Response.json({ error: 'ข้อมูลกิจกรรมไม่ถูกต้อง ตรวจรายละเอียด เวลา และวันที่อีกครั้ง' }, { status: 400 });
    }
    if (startDate && endDate && startDate > endDate) {
      return Response.json({ error: 'วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด' }, { status: 400 });
    }
    if (startTime && endTime && startTime >= endTime) {
      return Response.json({ error: 'เวลาเริ่มต้องก่อนเวลาสิ้นสุด' }, { status: 400 });
    }
    if (courseKey) {
      const [courseRows] = await pool.execute<RowDataPacket[]>(
        'SELECT subject_key FROM subjects WHERE subject_key = ? AND kind = ? AND (user_id IS NULL OR user_id = ?) AND (category_id IS NULL OR category_id = ?) LIMIT 1',
        [courseKey, 'subject', user.id, category.id],
      );
      if (!courseRows[0]) return Response.json({ error: 'ไม่พบรายวิชาที่ผูกกับกิจกรรม' }, { status: 400 });
    }

    connection = await pool.getConnection();
    await connection.beginTransaction();
    transactionStarted = true;
    await connection.execute(
      `UPDATE study_activities
       SET course_key = ?, title = ?, details = ?, weight = ?, duration_hours = ?,
           start_date = ?, end_date = ?, start_time = ?, end_time = ?
       WHERE id = ? AND user_id = ? AND category_id = ?`,
      [courseKey, title, details || null, weight, durationHours, startDate, endDate, startTime, endTime, activityId, user.id, category.id],
    );
    if (current.subjectKey) {
      await connection.execute(
        `UPDATE subjects
         SET label = ?, weight = ?, activity_details = ?, activity_duration_hours = ?,
             activity_start_date = ?, activity_end_date = ?, activity_start_time = ?,
             activity_end_time = ?, activity_course_key = ?
         WHERE subject_key = ? AND user_id = ? AND category_id = ? AND kind = 'activity'`,
        [title, weight, details || null, durationHours, startDate, endDate, startTime, endTime, courseKey, current.subjectKey, user.id, category.id],
      );
    }
    await connection.commit();
    transactionStarted = false;
    return Response.json({
      activity: {
        id: activityId,
        subjectKey: current.subjectKey,
        futureNote: current.futureNote ?? '',
        lectureNotes: current.lectureNotes ?? '',
        courseKey,
        title,
        details,
        weight: Number(weight),
        durationHours,
        startDate,
        endDate,
        startTime,
        endTime,
        isCompleted: Boolean(current.isCompleted),
      },
    });
  } catch (error) {
    if (connection && transactionStarted) {
      try {
        await connection.rollback();
      } catch {
        console.error('Update study activity rollback failed');
      }
    }
    console.error('Update study activity error:', error instanceof Error ? error.message : 'Unknown error');
    return Response.json({ error: 'แก้ไขกิจกรรมไม่สำเร็จ ตรวจสอบการเชื่อมต่อฐานข้อมูล' }, { status: 500 });
  } finally {
    connection?.release();
  }
}
