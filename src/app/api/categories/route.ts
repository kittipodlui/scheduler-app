import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { getSessionUser } from '@/lib/auth';
import { getOwnedCategory, getUserCategories } from '@/lib/categories';
import { ensureDatabase, getPool } from '@/lib/database';

export const runtime = 'nodejs';
const FIXED_CATEGORY_NAME = 'แผนการอ่านหนังสือ';

export async function GET(request: Request): Promise<Response> {
  let connection: PoolConnection | undefined;
  try {
    const pool = getPool();
    await ensureDatabase(pool);
    const user = await getSessionUser(request, pool);
    if (!user) return Response.json({ error: 'กรุณาเข้าสู่ระบบ' }, { status: 401 });

    connection = await pool.getConnection();
    await connection.beginTransaction();
    await connection.execute('SELECT id FROM users WHERE id = ? FOR UPDATE', [user.id]);
    const [fixedCategory] = await connection.execute<RowDataPacket[]>(
      'SELECT id FROM study_categories WHERE user_id = ? AND name = ? LIMIT 1',
      [user.id, FIXED_CATEGORY_NAME],
    );
    if (!fixedCategory[0]) {
      await connection.execute(
        'INSERT INTO study_categories (user_id, name) VALUES (?, ?)',
        [user.id, FIXED_CATEGORY_NAME],
      );
    }
    await connection.commit();
    return Response.json({ categories: await getUserCategories(pool, user.id) });
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch {
        console.error('Normalize study plan rollback failed');
      }
    }
    console.error('Load categories error:', error instanceof Error ? error.message : 'Unknown error');
    return Response.json({ error: 'โหลดหมวดหมู่ไม่สำเร็จ' }, { status: 500 });
  } finally {
    connection?.release();
  }
}

export async function POST(request: Request): Promise<Response> {
  let connection: PoolConnection | undefined;
  try {
    const pool = getPool();
    await ensureDatabase(pool);
    const user = await getSessionUser(request, pool);
    if (!user) return Response.json({ error: 'กรุณาเข้าสู่ระบบ' }, { status: 401 });

    const body: unknown = await request.json();
    const name = body && typeof body === 'object' && 'name' in body && typeof body.name === 'string'
      ? body.name.trim()
      : '';
    if (name.length < 1 || name.length > 60) {
      return Response.json({ error: 'ชื่อหมวดต้องมีความยาว 1–60 ตัวอักษร' }, { status: 400 });
    }
    if (name === FIXED_CATEGORY_NAME) {
      return Response.json({ error: 'ชื่อนี้สงวนไว้สำหรับแผนหลัก' }, { status: 400 });
    }

    connection = await pool.getConnection();
    await connection.beginTransaction();
    await connection.execute('SELECT id FROM users WHERE id = ? FOR UPDATE', [user.id]);
    const [categories] = await connection.execute<RowDataPacket[]>(
      'SELECT id FROM study_categories WHERE user_id = ?',
      [user.id],
    );
    if (categories.length >= 30) {
      await connection.rollback();
      return Response.json({ error: 'สร้างหมวดได้สูงสุด 30 หมวด' }, { status: 400 });
    }
    const [result] = await connection.execute<ResultSetHeader>(
      'INSERT INTO study_categories (user_id, name) VALUES (?, ?)',
      [user.id, name],
    );
    await connection.commit();
    return Response.json({
      category: { id: result.insertId, name, futureNote: '', lectureNotes: '' },
    }, { status: 201 });
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch {
        console.error('Create category transaction rollback failed');
      }
    }
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
    if (code === 'ER_DUP_ENTRY') return Response.json({ error: 'มีหมวดชื่อนี้แล้ว' }, { status: 409 });
    console.error('Create category error:', error instanceof Error ? error.message : 'Unknown error');
    return Response.json({ error: 'สร้างหมวดไม่สำเร็จ' }, { status: 500 });
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
    const categoryId = Number(input.categoryId);
    if (input.action === 'rename') {
      const name = typeof input.name === 'string' ? input.name.trim() : '';
      if (!Number.isSafeInteger(categoryId) || categoryId < 1 || name.length < 1 || name.length > 60) {
        return Response.json({ error: 'ชื่อหมวดต้องมีความยาว 1–60 ตัวอักษร' }, { status: 400 });
      }
      if (name === FIXED_CATEGORY_NAME) {
        return Response.json({ error: 'ชื่อนี้สงวนไว้สำหรับแผนหลัก' }, { status: 400 });
      }
      const category = await getOwnedCategory(pool, user.id, categoryId);
      if (!category) return Response.json({ error: 'ไม่พบหมวดนี้' }, { status: 404 });
      if (category.name === FIXED_CATEGORY_NAME) {
        return Response.json({ error: 'ไม่สามารถแก้ไขชื่อแผนหลักได้' }, { status: 403 });
      }
      await pool.execute(
        'UPDATE study_categories SET name = ? WHERE id = ? AND user_id = ?',
        [name, categoryId, user.id],
      );
      return Response.json({
        category: { ...category, name },
      });
    }

    const futureNote = typeof input.futureNote === 'string' ? input.futureNote : '';
    const lectureNotes = typeof input.lectureNotes === 'string' ? input.lectureNotes : '';
    if (!Number.isSafeInteger(categoryId) || categoryId < 1
      || futureNote.length > 10000 || lectureNotes.length > 10000) {
      return Response.json({ error: 'โน้ตต้องไม่เกิน 10,000 ตัวอักษร' }, { status: 400 });
    }

    if (!(await getOwnedCategory(pool, user.id, categoryId))) {
      return Response.json({ error: 'ไม่พบหมวดนี้' }, { status: 404 });
    }
    await pool.execute(
      'UPDATE study_categories SET future_note = ?, lecture_notes = ? WHERE id = ? AND user_id = ?',
      [futureNote, lectureNotes, categoryId, user.id],
    );
    const [rows] = await pool.execute<RowDataPacket[]>(
      "SELECT id, name, COALESCE(future_note, '') AS futureNote, COALESCE(lecture_notes, '') AS lectureNotes FROM study_categories WHERE id = ? AND user_id = ? LIMIT 1",
      [categoryId, user.id],
    );
    return Response.json({ category: rows[0] });
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
    if (code === 'ER_DUP_ENTRY') return Response.json({ error: 'มีหมวดชื่อนี้แล้ว' }, { status: 409 });
    console.error('Save category notes error:', error instanceof Error ? error.message : 'Unknown error');
    return Response.json({ error: 'บันทึกโน้ตไม่สำเร็จ' }, { status: 500 });
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
    const categoryId = body && typeof body === 'object' && 'categoryId' in body
      ? Number(body.categoryId)
      : Number.NaN;
    if (!Number.isSafeInteger(categoryId) || categoryId < 1) {
      return Response.json({ error: 'เลือกหมวดที่ต้องการลบ' }, { status: 400 });
    }

    connection = await pool.getConnection();
    await connection.beginTransaction();
    transactionStarted = true;
    const [ownedCategories] = await connection.execute<Array<RowDataPacket & { name: string }>>(
      'SELECT name FROM study_categories WHERE id = ? AND user_id = ? FOR UPDATE',
      [categoryId, user.id],
    );
    if (!ownedCategories[0]) {
      await connection.rollback();
      transactionStarted = false;
      return Response.json({ error: 'ไม่พบหมวดนี้' }, { status: 404 });
    }
    if (ownedCategories[0].name === FIXED_CATEGORY_NAME) {
      await connection.rollback();
      transactionStarted = false;
      return Response.json({ error: 'ไม่สามารถลบแผนหลักได้' }, { status: 403 });
    }

    await connection.execute(
      'DELETE FROM study_sessions WHERE schedule_id IN (SELECT id FROM schedules WHERE user_id = ? AND category_id = ?)',
      [user.id, categoryId],
    );
    await connection.execute(
      'DELETE FROM schedules WHERE user_id = ? AND category_id = ?',
      [user.id, categoryId],
    );
    await connection.execute(
      'DELETE preferences FROM user_subject_preferences preferences INNER JOIN subjects ON subjects.subject_key = preferences.subject_key WHERE preferences.user_id = ? AND subjects.user_id = ? AND subjects.category_id = ?',
      [user.id, user.id, categoryId],
    );
    await connection.execute(
      'DELETE FROM subjects WHERE user_id = ? AND category_id = ?',
      [user.id, categoryId],
    );
    await connection.execute(
      'DELETE FROM study_categories WHERE id = ? AND user_id = ?',
      [categoryId, user.id],
    );
    await connection.commit();
    transactionStarted = false;
    return Response.json({ categories: await getUserCategories(pool, user.id) });
  } catch (error) {
    if (connection && transactionStarted) {
      try {
        await connection.rollback();
      } catch {
        console.error('Delete category transaction rollback failed');
      }
    }
    console.error('Delete category error:', error instanceof Error ? error.message : 'Unknown error');
    return Response.json({ error: 'ลบหมวดไม่สำเร็จ' }, { status: 500 });
  } finally {
    connection?.release();
  }
}