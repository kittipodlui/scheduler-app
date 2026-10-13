import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';

export type StudyCategory = {
  id: number;
  name: string;
  futureNote: string;
  lectureNotes: string;
};

type StudyCategoryRow = RowDataPacket & StudyCategory;

function mapCategory(row: StudyCategoryRow): StudyCategory {
  return { ...row, id: Number(row.id) };
}

export async function getUserCategories(
  connection: Pool | PoolConnection,
  userId: number,
): Promise<StudyCategory[]> {
  const [rows] = await connection.execute<StudyCategoryRow[]>(
    "SELECT id, name, COALESCE(future_note, '') AS futureNote, COALESCE(lecture_notes, '') AS lectureNotes FROM study_categories WHERE user_id = ? ORDER BY created_at, id",
    [userId],
  );
  return rows.map(mapCategory);
}

export async function getOwnedCategory(
  connection: Pool | PoolConnection,
  userId: number,
  categoryId: number,
): Promise<StudyCategory | null> {
  const [rows] = await connection.execute<StudyCategoryRow[]>(
    "SELECT id, name, COALESCE(future_note, '') AS futureNote, COALESCE(lecture_notes, '') AS lectureNotes FROM study_categories WHERE id = ? AND user_id = ? LIMIT 1",
    [categoryId, userId],
  );
  return rows[0] ? mapCategory(rows[0]) : null;
}