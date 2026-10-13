import { randomBytes } from 'node:crypto';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { getSessionUser } from '@/lib/auth';
import { getOwnedCategory } from '@/lib/categories';
import { ensureDatabase, getPool, getUserSubjectLists } from '@/lib/database';
import { isPriorityWeight, isSubjectColor, type StudyItemKind } from '@/lib/subjects';

export const runtime = 'nodejs';

function isValidWeekStartDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  const [year, month, day] = value.split('-').map(Number);
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
    if (!user) return Response.json({ error: 'กรุณาเข้าสู่ระบบ' }, { status: 401 });

    const body: unknown = await request.json();
    if (!body || typeof body !== 'object') {
      return Response.json({ error: 'ข้อมูลวิชาไม่ถูกต้อง' }, { status: 400 });
    }

    const input = body as Record<string, unknown>;
    const requestedWeight = input.weight;
    const requestedColor = input.color;
    const activityDetails = typeof input.activityDetails === 'string' ? input.activityDetails.trim() : '';
    const activityDurationHours = input.activityDurationHours === undefined || input.activityDurationHours === ''
      ? null : Number(input.activityDurationHours);
    const activityStartDate = typeof input.activityStartDate === 'string' && input.activityStartDate ? input.activityStartDate : null;
    const activityEndDate = typeof input.activityEndDate === 'string' && input.activityEndDate ? input.activityEndDate : null;
    const activityStartTime = typeof input.activityStartTime === 'string' && input.activityStartTime ? input.activityStartTime : null;
    const activityEndTime = typeof input.activityEndTime === 'string' && input.activityEndTime ? input.activityEndTime : null;
    const activityCourseKey = typeof input.activityCourseKey === 'string' && input.activityCourseKey ? input.activityCourseKey : null;
    const categoryId = Number(input.categoryId);
    const rawScheduleOnlyDate = input.scheduleOnlyDate;
    const scheduleOnlyDate =
      typeof rawScheduleOnlyDate === 'string' && rawScheduleOnlyDate
        ? rawScheduleOnlyDate
        : null;
    if (rawScheduleOnlyDate !== undefined && rawScheduleOnlyDate !== null
      && rawScheduleOnlyDate !== '' && !isValidWeekStartDate(rawScheduleOnlyDate)) {
      return Response.json({ error: 'สัปดาห์ของชุดตารางไม่ถูกต้อง' }, { status: 400 });
    }
    if (!Number.isSafeInteger(categoryId) || categoryId < 1
      || !(await getOwnedCategory(pool, user.id, categoryId))) {
      return Response.json({ error: 'กรุณาเลือกหมวดที่เป็นของบัญชีคุณ' }, { status: 400 });
    }
    let subjectKey: string;
    let defaultWeight = 20;
    if (requestedWeight !== undefined && !isPriorityWeight(requestedWeight)) {
      return Response.json({ error: 'ค่าน้ำหนักต้องเป็น 10%, 20%, 25% หรือ 30%' }, { status: 400 });
    }
    if (requestedColor !== undefined && !isSubjectColor(requestedColor)) {
      return Response.json({ error: 'เลือกสีวิชาจากชุดสีที่กำหนด' }, { status: 400 });
    }
    if (isPriorityWeight(requestedWeight)) defaultWeight = requestedWeight;
    if (typeof input.subjectKey === 'string') {
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT subjects.subject_key, COALESCE(preferences.weight, subjects.weight) AS weight
         FROM subjects
         LEFT JOIN user_subject_preferences AS preferences
           ON preferences.subject_key = subjects.subject_key AND preferences.user_id = ?
         WHERE subjects.subject_key = ? AND subjects.user_id = ? AND subjects.category_id = ?
           AND subjects.schedule_only_date <=> ?
         LIMIT 1`,
        [user.id, input.subjectKey, user.id, categoryId, scheduleOnlyDate],
      );
      if (!rows[0]) return Response.json({ error: 'ไม่พบวิชาที่เลือก' }, { status: 400 });
      subjectKey = rows[0].subject_key as string;
      defaultWeight = rows[0].weight as number;
      if (isSubjectColor(requestedColor)) {
        await pool.execute(
          'UPDATE subjects SET color = ? WHERE subject_key = ? AND user_id = ? AND category_id = ? AND kind = ?',
          [requestedColor, subjectKey, user.id, categoryId, 'subject'],
        );
      }
    } else {
      const label = typeof input.label === 'string' ? input.label.trim() : '';
      const kind = input.kind;
      if (label.length < 1 || label.length > 60 || (kind !== 'subject' && kind !== 'activity')) {
        return Response.json({ error: 'กรอกชื่อรายการ 1–60 ตัวอักษรและเลือกประเภทให้ถูกต้อง' }, { status: 400 });
      }
      if (kind === 'activity') {
        const validDate = (value: string | null) => value === null || /^\d{4}-\d{2}-\d{2}$/.test(value);
        const validTime = (value: string | null) => value === null || /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
        if ((activityDurationHours !== null && (!Number.isFinite(activityDurationHours) || activityDurationHours < 0.25 || activityDurationHours > 24))
          || !validDate(activityStartDate) || !validDate(activityEndDate)
          || !validTime(activityStartTime) || !validTime(activityEndTime)
          || activityDetails.length > 1000) {
          return Response.json({ error: 'ข้อมูลกิจกรรมไม่ถูกต้อง ตรวจรายละเอียด เวลา และวันที่อีกครั้ง' }, { status: 400 });
        }
        if (activityStartDate && activityEndDate && activityStartDate > activityEndDate) {
          return Response.json({ error: 'วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด' }, { status: 400 });
        }
        if (activityStartTime && activityEndTime && activityStartTime >= activityEndTime) {
          return Response.json({ error: 'เวลาเริ่มต้องก่อนเวลาสิ้นสุด' }, { status: 400 });
        }
        if (activityCourseKey) {
          const [courseRows] = await pool.execute<RowDataPacket[]>(
            'SELECT subject_key FROM subjects WHERE subject_key = ? AND kind = \'subject\' AND (user_id IS NULL OR user_id = ?) AND (category_id IS NULL OR category_id = ?) LIMIT 1',
            [activityCourseKey, user.id, categoryId],
          );
          if (!courseRows[0]) return Response.json({ error: 'ไม่พบรายวิชาที่ผูกกับกิจกรรม' }, { status: 400 });
        }
      }

      const [customItems] = await pool.execute<RowDataPacket[]>(
        'SELECT subject_key FROM subjects WHERE user_id = ? AND category_id = ? AND label = ? AND kind = ? AND schedule_only_date <=> ? LIMIT 1',
        [user.id, categoryId, label, kind, scheduleOnlyDate],
      );
      if (customItems[0]) {
        subjectKey = customItems[0].subject_key as string;
      } else {
        const [counts] = await pool.execute<RowDataPacket[]>(
          'SELECT COUNT(*) AS item_count FROM subjects WHERE user_id = ? AND category_id = ? AND schedule_only_date <=> ?',
          [user.id, categoryId, scheduleOnlyDate],
        );
        if (Number(counts[0].item_count) >= 50) {
          return Response.json({ error: 'เพิ่มรายการกำหนดเองได้สูงสุด 50 รายการ' }, { status: 400 });
        }
        subjectKey = `custom_${randomBytes(12).toString('hex')}`;
        const color = kind === 'activity' ? '#bd7950' : (isSubjectColor(requestedColor) ? requestedColor : '#5479a8');
        await pool.execute(
          'INSERT INTO subjects (subject_key, user_id, category_id, kind, label, color, weight, manual_only, schedule_only_date, activity_details, activity_duration_hours, activity_start_date, activity_end_date, activity_start_time, activity_end_time, activity_course_key, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 100)',
          [subjectKey, user.id, categoryId, kind as StudyItemKind, label, color, defaultWeight,
            scheduleOnlyDate ? 1 : 0, scheduleOnlyDate,
            kind === 'activity' ? activityDetails : null,
            kind === 'activity' ? activityDurationHours : null,
            kind === 'activity' ? activityStartDate : null,
            kind === 'activity' ? activityEndDate : null,
            kind === 'activity' ? activityStartTime : null,
            kind === 'activity' ? activityEndTime : null,
            kind === 'activity' ? activityCourseKey : null],
        );
      }
    }

    await pool.execute(
      'INSERT INTO user_subject_preferences (user_id, subject_key, weight, is_added) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE is_added = 1',
      [user.id, subjectKey, defaultWeight],
    );
    return Response.json(await getUserSubjectLists(pool, user.id, categoryId, scheduleOnlyDate));
  } catch (error) {
    console.error('Add subject error:', error instanceof Error ? error.message : 'Unknown error');
    return Response.json({ error: 'เพิ่มวิชาไม่สำเร็จ ตรวจสอบการเชื่อมต่อฐานข้อมูล' }, { status: 500 });
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

    const body: unknown = await request.json();
    const subjectKey = body && typeof body === 'object' && 'subjectKey' in body
      ? body.subjectKey
      : undefined;
    const categoryId = body && typeof body === 'object' && 'categoryId' in body
      ? Number(body.categoryId)
      : Number.NaN;
    const scheduleOnlyDate = body && typeof body === 'object'
      && 'scheduleOnlyDate' in body
      && typeof body.scheduleOnlyDate === 'string' && body.scheduleOnlyDate
      ? body.scheduleOnlyDate
      : null;
    if (scheduleOnlyDate !== null && !isValidWeekStartDate(scheduleOnlyDate)) {
      return Response.json({ error: 'สัปดาห์ของชุดตารางไม่ถูกต้อง' }, { status: 400 });
    }
    if (typeof subjectKey !== 'string' || !Number.isSafeInteger(categoryId)
      || !(await getOwnedCategory(pool, user.id, categoryId))) {
      return Response.json({ error: 'ไม่พบวิชาที่เลือก' }, { status: 400 });
    }

    connection = await pool.getConnection();
    await connection.beginTransaction();
    transactionStarted = true;

    const [ownedSubjects] = await connection.execute<Array<RowDataPacket & { kind: StudyItemKind }>>(
      'SELECT kind FROM subjects WHERE subject_key = ? AND user_id = ? AND category_id = ? AND schedule_only_date <=> ? LIMIT 1',
      [subjectKey, user.id, categoryId, scheduleOnlyDate],
    );
    if (!ownedSubjects[0]) {
      await connection.rollback();
      transactionStarted = false;
      return Response.json({ error: 'ไม่พบวิชาที่เลือก' }, { status: 404 });
    }

    if (ownedSubjects[0].kind === 'subject') {
      await connection.execute(
        'DELETE study_sessions FROM study_sessions INNER JOIN schedules ON schedules.id = study_sessions.schedule_id WHERE schedules.user_id = ? AND schedules.category_id = ? AND study_sessions.subject_key = ?',
        [user.id, categoryId, subjectKey],
      );
      await connection.execute(
        'DELETE FROM user_subject_preferences WHERE user_id = ? AND subject_key = ?',
        [user.id, subjectKey],
      );
      await connection.execute(
        'DELETE FROM subjects WHERE subject_key = ? AND user_id = ? AND category_id = ? AND kind = ?',
        [subjectKey, user.id, categoryId, 'subject'],
      );
    } else {
      await connection.execute(
        'UPDATE user_subject_preferences SET is_added = 0 WHERE user_id = ? AND subject_key = ?',
        [user.id, subjectKey],
      );
      await connection.execute(
        'DELETE study_sessions FROM study_sessions INNER JOIN schedules ON schedules.id = study_sessions.schedule_id WHERE schedules.user_id = ? AND schedules.category_id = ? AND study_sessions.subject_key = ?',
        [user.id, categoryId, subjectKey],
      );
    }

    if (scheduleOnlyDate) {
      await connection.execute(
        'DELETE FROM schedules WHERE user_id = ? AND category_id = ? AND week_start_date = ? AND NOT EXISTS (SELECT 1 FROM study_sessions WHERE study_sessions.schedule_id = schedules.id)',
        [user.id, categoryId, scheduleOnlyDate],
      );
    }

    const subjectLists = await getUserSubjectLists(connection, user.id, categoryId, scheduleOnlyDate);
    await connection.commit();
    transactionStarted = false;
    return Response.json(subjectLists);
  } catch (error) {
    if (connection && transactionStarted) {
      try {
        await connection.rollback();
      } catch {
        console.error('Remove subject rollback failed');
      }
    }
    console.error('Remove subject error:', error instanceof Error ? error.message : 'Unknown error');
    return Response.json({ error: 'นำวิชาออกไม่สำเร็จ ตรวจสอบการเชื่อมต่อฐานข้อมูล' }, { status: 500 });
  } finally {
    connection?.release();
  }
}
export async function PATCH(request: Request): Promise<Response> {
  try {
    const pool = getPool();
    await ensureDatabase(pool);
    const user = await getSessionUser(request, pool);
    if (!user) return Response.json({ error: 'กรุณาเข้าสู่ระบบ' }, { status: 401 });

    const body: unknown = await request.json();
    if (!body || typeof body !== 'object') {
      return Response.json({ error: 'ข้อมูลโน้ตไม่ถูกต้อง' }, { status: 400 });
    }
    const input = body as Record<string, unknown>;
    if (input.action === 'color') {
      const categoryId = Number(input.categoryId);
      const subjectKey = typeof input.subjectKey === 'string' ? input.subjectKey : '';
      const scheduleOnlyDate = typeof input.scheduleOnlyDate === 'string' ? input.scheduleOnlyDate : null;
      if ((scheduleOnlyDate !== null && !isValidWeekStartDate(scheduleOnlyDate))
        || !Number.isSafeInteger(categoryId) || categoryId < 1 || !subjectKey || !isSubjectColor(input.color)) {
        return Response.json({ error: 'ข้อมูลสีวิชาไม่ถูกต้อง' }, { status: 400 });
      }
      if (!(await getOwnedCategory(pool, user.id, categoryId))) {
        return Response.json({ error: 'ไม่พบหมวดนี้' }, { status: 404 });
      }
      const [ownedSubjects] = await pool.execute<RowDataPacket[]>(
        'SELECT subject_key FROM subjects WHERE subject_key = ? AND user_id = ? AND category_id = ? AND kind = ? AND schedule_only_date <=> ? LIMIT 1',
        [subjectKey, user.id, categoryId, 'subject', scheduleOnlyDate],
      );
      if (!ownedSubjects[0]) {
        return Response.json({ error: 'ไม่พบวิชาที่เลือกในหมวดนี้' }, { status: 404 });
      }
      await pool.execute(
        'UPDATE subjects SET color = ? WHERE subject_key = ? AND user_id = ? AND category_id = ? AND kind = ?',
        [input.color, subjectKey, user.id, categoryId, 'subject'],
      );
      return Response.json(await getUserSubjectLists(pool, user.id, categoryId, scheduleOnlyDate));
    }

    const categoryId = Number(input.categoryId);
    const subjectKey = typeof input.subjectKey === 'string' ? input.subjectKey : '';
    const futureNote = typeof input.futureNote === 'string' ? input.futureNote : '';
    const lectureNotes = typeof input.lectureNotes === 'string' ? input.lectureNotes : '';
    if (!Number.isSafeInteger(categoryId) || categoryId < 1 || !subjectKey
      || futureNote.length > 10000 || lectureNotes.length > 10000) {
      return Response.json({ error: 'ข้อมูลโน้ตไม่ถูกต้องหรือยาวเกิน 10,000 ตัวอักษร' }, { status: 400 });
    }
    if (!(await getOwnedCategory(pool, user.id, categoryId))) {
      return Response.json({ error: 'ไม่พบหมวดนี้' }, { status: 404 });
    }
    const [ownedSubject] = await pool.execute<RowDataPacket[]>(
      `SELECT s.subject_key, s.user_id FROM subjects s
       INNER JOIN user_subject_preferences p ON p.subject_key = s.subject_key AND p.user_id = ? AND p.is_added = 1
       WHERE s.subject_key = ? AND (s.user_id IS NULL OR s.user_id = ?)
         AND (s.category_id IS NULL OR s.category_id = ?) LIMIT 1`,
      [user.id, subjectKey, user.id, categoryId],
    );
    if (!ownedSubject[0]) return Response.json({ error: 'ไม่พบวิชานี้ในหมวดที่เลือก' }, { status: 404 });

    if (ownedSubject[0].user_id === null) {
      await pool.execute(
        'UPDATE user_subject_preferences SET future_note = ?, lecture_notes = ? WHERE user_id = ? AND subject_key = ? AND is_added = 1',
        [futureNote, lectureNotes, user.id, subjectKey],
      );
    } else {
      await pool.execute(
        'UPDATE subjects SET future_note = ?, lecture_notes = ? WHERE subject_key = ? AND user_id = ? AND category_id = ?',
        [futureNote, lectureNotes, subjectKey, user.id, categoryId],
      );
    }
    return Response.json(await getUserSubjectLists(pool, user.id, categoryId));
  } catch (error) {
    console.error('Save subject notes error:', error instanceof Error ? error.message : 'Unknown error');
    return Response.json({ error: 'บันทึกโน้ตวิชาไม่สำเร็จ' }, { status: 500 });
  }
}
