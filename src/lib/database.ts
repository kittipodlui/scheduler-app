import mysql, { type Pool, type PoolConnection, type RowDataPacket } from 'mysql2/promise';
import type { SubjectPreference } from './subjects';

declare global { var studyPlannerPool: Pool | undefined; }

export function getPool(): Pool {
  if (!globalThis.studyPlannerPool) {
    globalThis.studyPlannerPool = mysql.createPool({
      host: process.env.MYSQL_HOST ?? process.env.DB_HOST,
      port: Number(process.env.MYSQL_PORT ?? process.env.DB_PORT ?? 3306),
      user: process.env.MYSQL_USER ?? process.env.DB_USER,
      password: process.env.MYSQL_PASSWORD ?? process.env.DB_PASSWORD,
      database: process.env.MYSQL_DATABASE ?? process.env.DB_NAME ?? 'study_scheduler',
      waitForConnections: true,
      connectionLimit: 10,
      charset: 'utf8mb4',
    });
  }
  return globalThis.studyPlannerPool;
}

export async function ensureDatabase(connection: Pool | PoolConnection): Promise<void> {
  await connection.execute(`CREATE TABLE IF NOT EXISTS users (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(32) NOT NULL UNIQUE, email VARCHAR(254) NULL, password_hash VARCHAR(255) NOT NULL,
    role ENUM('user', 'admin') NOT NULL DEFAULT 'user', active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  const [emailColumn] = await connection.query<RowDataPacket[]>("SHOW COLUMNS FROM users LIKE 'email'");
  if (!emailColumn.length) await connection.execute('ALTER TABLE users ADD COLUMN email VARCHAR(254) NULL AFTER username');
  const [emailIndex] = await connection.query<RowDataPacket[]>("SHOW INDEX FROM users WHERE Key_name = 'unique_user_email'");
  if (!emailIndex.length) await connection.execute('ALTER TABLE users ADD UNIQUE KEY unique_user_email (email)');
  const [role] = await connection.query<RowDataPacket[]>("SHOW COLUMNS FROM users LIKE 'role'");
  if (!role.length) await connection.execute("ALTER TABLE users ADD COLUMN role ENUM('user', 'admin') NOT NULL DEFAULT 'user' AFTER password_hash");
  const [active] = await connection.query<RowDataPacket[]>("SHOW COLUMNS FROM users LIKE 'active'");
  if (!active.length) await connection.execute("ALTER TABLE users ADD COLUMN active TINYINT(1) NOT NULL DEFAULT 1 AFTER role");
  await connection.execute(`CREATE TABLE IF NOT EXISTS study_categories (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, user_id BIGINT UNSIGNED NOT NULL,
    name VARCHAR(60) NOT NULL, future_note TEXT NULL, lecture_notes TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_user_category (user_id, name),
    CONSTRAINT fk_category_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await connection.execute(`CREATE TABLE IF NOT EXISTS subjects (
    subject_key VARCHAR(32) PRIMARY KEY, user_id BIGINT UNSIGNED NULL, category_id BIGINT UNSIGNED NULL,
    kind VARCHAR(16) NOT NULL DEFAULT 'subject', label VARCHAR(80) NOT NULL,
    color VARCHAR(7) NOT NULL DEFAULT '#64756d', weight TINYINT UNSIGNED NOT NULL DEFAULT 20,
    is_completed TINYINT(1) NOT NULL DEFAULT 0,
    future_note TEXT NULL, lecture_notes TEXT NULL,
    manual_only TINYINT(1) NOT NULL DEFAULT 0, schedule_only_date DATE NULL,
    sort_order TINYINT UNSIGNED NOT NULL, KEY idx_subject_owner (user_id), KEY idx_subject_category (category_id),
    CONSTRAINT fk_subject_owner FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_subject_category FOREIGN KEY (category_id) REFERENCES study_categories(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  const [futureNoteColumn] = await connection.query<RowDataPacket[]>("SHOW COLUMNS FROM subjects LIKE 'future_note'");
  if (!futureNoteColumn.length) await connection.execute("ALTER TABLE subjects ADD COLUMN future_note TEXT NULL AFTER weight");
  const [lectureNotesColumn] = await connection.query<RowDataPacket[]>("SHOW COLUMNS FROM subjects LIKE 'lecture_notes'");
  if (!lectureNotesColumn.length) await connection.execute("ALTER TABLE subjects ADD COLUMN lecture_notes TEXT NULL AFTER future_note");
  const [manualOnlyColumn] = await connection.query<RowDataPacket[]>("SHOW COLUMNS FROM subjects LIKE 'manual_only'");
  if (!manualOnlyColumn.length) await connection.execute("ALTER TABLE subjects ADD COLUMN manual_only TINYINT(1) NOT NULL DEFAULT 0 AFTER lecture_notes");
  const [scheduleOnlyDateColumn] = await connection.query<RowDataPacket[]>("SHOW COLUMNS FROM subjects LIKE 'schedule_only_date'");
  if (!scheduleOnlyDateColumn.length) await connection.execute("ALTER TABLE subjects ADD COLUMN schedule_only_date DATE NULL AFTER manual_only");
  const [subjectCompletionColumn] = await connection.query<RowDataPacket[]>("SHOW COLUMNS FROM subjects LIKE 'is_completed'");
  if (!subjectCompletionColumn.length) await connection.execute("ALTER TABLE subjects ADD COLUMN is_completed TINYINT(1) NOT NULL DEFAULT 0 AFTER weight");
  const activityDetailColumns: Array<[string, string]> = [
    ['activity_details', 'TEXT NULL AFTER lecture_notes'],
    ['activity_duration_hours', 'DECIMAL(5,2) NULL AFTER activity_details'],
    ['activity_start_date', 'DATE NULL AFTER activity_duration_hours'],
    ['activity_end_date', 'DATE NULL AFTER activity_start_date'],
    ['activity_start_time', 'TIME NULL AFTER activity_end_date'],
    ['activity_end_time', 'TIME NULL AFTER activity_start_time'],
    ['activity_course_key', 'VARCHAR(32) NULL AFTER activity_end_time'],
  ];
  for (const [columnName, definition] of activityDetailColumns) {
    const [column] = await connection.query<RowDataPacket[]>("SHOW COLUMNS FROM subjects LIKE ?", [columnName]);
    if (!column.length) await connection.execute(`ALTER TABLE subjects ADD COLUMN ${columnName} ${definition}`);
  }

  await connection.execute(`CREATE TABLE IF NOT EXISTS user_subject_preferences (
    user_id BIGINT UNSIGNED NOT NULL, subject_key VARCHAR(32) NOT NULL,
    weight TINYINT UNSIGNED NOT NULL DEFAULT 20, is_added TINYINT(1) NOT NULL DEFAULT 0,
    future_note TEXT NULL, lecture_notes TEXT NULL,
    PRIMARY KEY (user_id, subject_key),
    CONSTRAINT fk_preference_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_preference_subject FOREIGN KEY (subject_key) REFERENCES subjects(subject_key)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  const [preferenceFutureNoteColumn] = await connection.query<RowDataPacket[]>("SHOW COLUMNS FROM user_subject_preferences LIKE 'future_note'");
  if (!preferenceFutureNoteColumn.length) await connection.execute("ALTER TABLE user_subject_preferences ADD COLUMN future_note TEXT NULL AFTER is_added");
  const [preferenceLectureNotesColumn] = await connection.query<RowDataPacket[]>("SHOW COLUMNS FROM user_subject_preferences LIKE 'lecture_notes'");
  if (!preferenceLectureNotesColumn.length) await connection.execute("ALTER TABLE user_subject_preferences ADD COLUMN lecture_notes TEXT NULL AFTER future_note");

  await connection.execute(`CREATE TABLE IF NOT EXISTS schedules (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NULL,
    category_id BIGINT UNSIGNED NULL,
    week_start_date DATE NOT NULL,
    days_per_week TINYINT UNSIGNED NOT NULL,
    sessions_per_day TINYINT UNSIGNED NOT NULL,
    start_time TIME NOT NULL DEFAULT '20:00:00',
    end_time TIME NOT NULL DEFAULT '22:00:00',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_schedules_user (user_id),
    KEY idx_schedule_category (category_id),
    KEY idx_schedule_user_category_week (user_id, category_id, week_start_date, id),
    CONSTRAINT fk_schedule_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_schedule_category FOREIGN KEY (category_id) REFERENCES study_categories(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  const [weekStartDateColumn] = await connection.query<RowDataPacket[]>(
    "SHOW COLUMNS FROM schedules LIKE 'week_start_date'",
  );

  if (!weekStartDateColumn.length) {
    await connection.execute(
      "ALTER TABLE schedules ADD COLUMN week_start_date DATE NULL AFTER category_id",
    );
  }

  await connection.execute(`
    UPDATE schedules
    SET week_start_date =
      DATE_SUB(
        DATE(created_at),
        INTERVAL WEEKDAY(created_at) DAY
      )
    WHERE week_start_date IS NULL
  `);

  const [updatedWeekStartDateColumn] = await connection.query<RowDataPacket[]>(
    "SHOW COLUMNS FROM schedules LIKE 'week_start_date'",
  );

  if (
    updatedWeekStartDateColumn.length &&
    updatedWeekStartDateColumn[0].Null === "YES"
  ) {
    await connection.execute(
      "ALTER TABLE schedules MODIFY COLUMN week_start_date DATE NOT NULL",
    );
  }

  const [scheduleWeekIndex] = await connection.query<RowDataPacket[]>(
    "SHOW INDEX FROM schedules WHERE Key_name = 'idx_schedule_user_category_week'",
  );

  if (!scheduleWeekIndex.length) {
    await connection.execute(`
      CREATE INDEX idx_schedule_user_category_week
      ON schedules (user_id, category_id, week_start_date, id)
    `);
  }
  await connection.execute(`CREATE TABLE IF NOT EXISTS auth_sessions (
    token_hash CHAR(64) NOT NULL PRIMARY KEY, user_id BIGINT UNSIGNED NOT NULL,
    expires_at DATETIME NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_auth_sessions_user (user_id),
    CONSTRAINT fk_auth_session_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await connection.execute(`CREATE TABLE IF NOT EXISTS study_sessions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, schedule_id BIGINT UNSIGNED NOT NULL,
    day_index TINYINT UNSIGNED NOT NULL, session_index TINYINT UNSIGNED NOT NULL,
    subject_key VARCHAR(32) NOT NULL, is_completed TINYINT(1) NOT NULL DEFAULT 0,
    future_note TEXT NULL, lecture_notes TEXT NULL,
    UNIQUE KEY one_subject_per_slot (schedule_id, day_index, session_index),
    CONSTRAINT fk_session_schedule FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE CASCADE,
    CONSTRAINT fk_session_subject FOREIGN KEY (subject_key) REFERENCES subjects(subject_key)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  const [sessionFutureNoteColumn] = await connection.query<RowDataPacket[]>("SHOW COLUMNS FROM study_sessions LIKE 'future_note'");
  if (!sessionFutureNoteColumn.length) await connection.execute("ALTER TABLE study_sessions ADD COLUMN future_note TEXT NULL AFTER is_completed");
  const [sessionLectureNotesColumn] = await connection.query<RowDataPacket[]>("SHOW COLUMNS FROM study_sessions LIKE 'lecture_notes'");
  if (!sessionLectureNotesColumn.length) await connection.execute("ALTER TABLE study_sessions ADD COLUMN lecture_notes TEXT NULL AFTER future_note");

  await connection.execute(`CREATE TABLE IF NOT EXISTS manual_study_blocks (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL, category_id BIGINT UNSIGNED NOT NULL,
    subject_key VARCHAR(32) NOT NULL,
    day_index TINYINT UNSIGNED NOT NULL, scheduled_date DATE NULL, start_time TIME NOT NULL,
    duration_minutes SMALLINT UNSIGNED NOT NULL,
    block_type ENUM('study', 'review', 'understanding', 'planning') NOT NULL DEFAULT 'study',
    is_completed TINYINT(1) NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_manual_blocks_category_day (user_id, category_id, day_index),
    KEY idx_manual_blocks_schedule_date (user_id, category_id, scheduled_date),
    CONSTRAINT fk_manual_block_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_manual_block_category FOREIGN KEY (category_id) REFERENCES study_categories(id) ON DELETE CASCADE,
    CONSTRAINT fk_manual_block_subject FOREIGN KEY (subject_key) REFERENCES subjects(subject_key) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  const [manualScheduledDateColumn] = await connection.query<RowDataPacket[]>(
    "SHOW COLUMNS FROM manual_study_blocks LIKE 'scheduled_date'",
  );
  if (!manualScheduledDateColumn.length) {
    await connection.execute(
      "ALTER TABLE manual_study_blocks ADD COLUMN scheduled_date DATE NULL AFTER day_index",
    );
  }
  const [manualScheduledDateIndex] = await connection.query<RowDataPacket[]>(
    "SHOW INDEX FROM manual_study_blocks WHERE Key_name = 'idx_manual_blocks_schedule_date'",
  );
  if (!manualScheduledDateIndex.length) {
    await connection.execute(
      "CREATE INDEX idx_manual_blocks_schedule_date ON manual_study_blocks (user_id, category_id, scheduled_date)",
    );
  }
  await connection.execute(`CREATE TABLE IF NOT EXISTS study_activities (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL, category_id BIGINT UNSIGNED NOT NULL,
    activity_type ENUM('study', 'homework', 'project', 'review') NULL DEFAULT NULL,
    course_key VARCHAR(32) NULL, activity_subject_key VARCHAR(32) NULL,
    title VARCHAR(100) NOT NULL, details TEXT NULL,
    weight TINYINT UNSIGNED NOT NULL DEFAULT 20, duration_hours DECIMAL(5,2) NOT NULL,
    start_date DATE NULL, end_date DATE NULL, start_time TIME NULL, end_time TIME NULL,
    is_completed TINYINT(1) NOT NULL DEFAULT 0, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_study_activities_owner (user_id, category_id, start_date),
    KEY idx_study_activities_course (course_key),
    CONSTRAINT fk_study_activity_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_study_activity_category FOREIGN KEY (category_id) REFERENCES study_categories(id) ON DELETE CASCADE,
    CONSTRAINT fk_study_activity_course FOREIGN KEY (course_key) REFERENCES subjects(subject_key) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  const [activityTypeColumn] = await connection.query<RowDataPacket[]>("SHOW COLUMNS FROM study_activities LIKE 'activity_type'");
  if (!activityTypeColumn.length) {
    await connection.execute("ALTER TABLE study_activities ADD COLUMN activity_type ENUM('study', 'homework', 'project', 'review') NULL DEFAULT NULL AFTER category_id");
  } else if (activityTypeColumn[0].Null === 'NO') {
    await connection.execute("ALTER TABLE study_activities MODIFY COLUMN activity_type ENUM('study', 'homework', 'project', 'review') NULL DEFAULT NULL");
    await connection.execute("UPDATE study_activities SET activity_type = NULL WHERE activity_type = 'study'");
  }
  const [activitySubjectKeyColumn] = await connection.query<RowDataPacket[]>("SHOW COLUMNS FROM study_activities LIKE 'activity_subject_key'");
  if (!activitySubjectKeyColumn.length) {
    await connection.execute('ALTER TABLE study_activities ADD COLUMN activity_subject_key VARCHAR(32) NULL AFTER course_key');
  }
  await connection.execute(`CREATE TABLE IF NOT EXISTS study_schedule_events (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL, category_id BIGINT UNSIGNED NOT NULL,
    schedule_id BIGINT UNSIGNED NULL,
    event_type ENUM('ga_generated', 'session_customized', 'session_completed', 'session_reopened', 'manual_block_added', 'manual_block_completed', 'manual_block_reopened', 'manual_block_removed') NOT NULL,
    details JSON NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_schedule_events_owner (user_id, category_id, created_at),
    CONSTRAINT fk_schedule_event_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_schedule_event_category FOREIGN KEY (category_id) REFERENCES study_categories(id) ON DELETE CASCADE,
    CONSTRAINT fk_schedule_event_schedule FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  // Upgrade legacy event_type enums without removing existing values.
  const [scheduleEventTypeColumn] = await connection.query<RowDataPacket[]>(
    "SHOW COLUMNS FROM study_schedule_events LIKE 'event_type'",
  );
  const currentEventType = String(scheduleEventTypeColumn[0]?.Type ?? "");
  const existingEventTypes = (currentEventType.match(/'([^']*)'/g) ?? []).map(
    (value) => value.slice(1, -1),
  );
  const requiredEventTypes = [
    "ga_generated",
    "session_customized",
    "session_completed",
    "session_reopened",
    "manual_block_added",
    "manual_block_completed",
    "manual_block_reopened",
    "manual_block_removed",
    "mode_changed",
  ];
  if (requiredEventTypes.some((value) => !existingEventTypes.includes(value))) {
    const mergedEventTypes = [
      ...new Set([...existingEventTypes, ...requiredEventTypes]),
    ];
    const eventTypeDefinition = mergedEventTypes
      .map((value) => "'" + value.replace(/'/g, "''") + "'")
      .join(", ");
    await connection.execute(
      "ALTER TABLE study_schedule_events MODIFY COLUMN event_type ENUM(" +
        eventTypeDefinition +
        ") NOT NULL",
    );
  }
}

type SubjectRow = RowDataPacket & {
  subject_key: string; label: string; color: string; weight: number; kind: 'subject' | 'activity';
  futureNote: string | null; lectureNotes: string | null;
  manualOnly: number;
  isCompleted: number;
  scheduleOnlyDate: string | null;
  activityDetails: string | null; activityDurationHours: number | null;
  activityStartDate: string | null; activityEndDate: string | null;
  activityStartTime: string | null; activityEndTime: string | null;
  activityCourseKey: string | null;
};

export async function getUserSubjectLists(
  connection: Pool | PoolConnection,
  userId: number,
  categoryId: number,
  scheduleWeekStartDate: string | null = null,
): Promise<{ subjects: SubjectPreference[]; availableSubjects: SubjectPreference[] }> {
  const [rows] = await connection.execute<SubjectRow[]>(
    `SELECT s.subject_key, s.label, s.color, p.weight, s.kind,
            COALESCE(s.future_note, '') AS futureNote,
            COALESCE(s.lecture_notes, '') AS lectureNotes,
            s.manual_only AS manualOnly,
            s.is_completed AS isCompleted,
            DATE_FORMAT(s.schedule_only_date, '%Y-%m-%d') AS scheduleOnlyDate,
            COALESCE(s.activity_details, '') AS activityDetails,
            s.activity_duration_hours AS activityDurationHours,
            DATE_FORMAT(s.activity_start_date, '%Y-%m-%d') AS activityStartDate,
            DATE_FORMAT(s.activity_end_date, '%Y-%m-%d') AS activityEndDate,
            s.activity_start_time AS activityStartTime,
            s.activity_end_time AS activityEndTime,
            s.activity_course_key AS activityCourseKey
     FROM subjects s INNER JOIN user_subject_preferences p ON p.subject_key = s.subject_key AND p.user_id = ?
     WHERE p.is_added = 1 AND s.user_id = ? AND s.category_id = ?
       AND ((? IS NULL AND s.schedule_only_date IS NULL) OR s.schedule_only_date = ?)
     ORDER BY s.sort_order, s.label`, [userId, userId, categoryId, scheduleWeekStartDate, scheduleWeekStartDate],
  );
  const [available] = await connection.execute<SubjectRow[]>(
    `SELECT s.subject_key, s.label, s.color, COALESCE(p.weight, s.weight) AS weight, s.kind,
            COALESCE(s.future_note, '') AS futureNote,
            COALESCE(s.lecture_notes, '') AS lectureNotes,
            s.manual_only AS manualOnly,
            s.is_completed AS isCompleted,
            DATE_FORMAT(s.schedule_only_date, '%Y-%m-%d') AS scheduleOnlyDate,
            COALESCE(s.activity_details, '') AS activityDetails,
            s.activity_duration_hours AS activityDurationHours,
            DATE_FORMAT(s.activity_start_date, '%Y-%m-%d') AS activityStartDate,
            DATE_FORMAT(s.activity_end_date, '%Y-%m-%d') AS activityEndDate,
            s.activity_start_time AS activityStartTime,
            s.activity_end_time AS activityEndTime,
            s.activity_course_key AS activityCourseKey
     FROM subjects s LEFT JOIN user_subject_preferences p ON p.subject_key = s.subject_key AND p.user_id = ?
     WHERE s.user_id = ? AND s.category_id = ?
       AND COALESCE(p.is_added, 0) = 0
       AND ((? IS NULL AND s.schedule_only_date IS NULL) OR s.schedule_only_date = ?)
     ORDER BY s.sort_order, s.label`, [userId, userId, categoryId, scheduleWeekStartDate, scheduleWeekStartDate],
  );
  const map = (items: SubjectRow[]): SubjectPreference[] => items.map((item) => ({
    key: item.subject_key, label: item.label, color: item.color,
    weight: Number(item.weight) as SubjectPreference['weight'], kind: item.kind,
    manualOnly: Boolean(item.manualOnly),
    isCompleted: Boolean(item.isCompleted),
    scheduleOnlyDate: item.scheduleOnlyDate ?? null,
    futureNote: item.futureNote ?? '', lectureNotes: item.lectureNotes ?? '',
    activityDetails: item.activityDetails ?? '',
    activityDurationHours: item.activityDurationHours === null ? null : Number(item.activityDurationHours),
    activityStartDate: item.activityStartDate ?? null,
    activityEndDate: item.activityEndDate ?? null,
    activityStartTime: item.activityStartTime ?? null,
    activityEndTime: item.activityEndTime ?? null,
    activityCourseKey: item.activityCourseKey ?? null,
  }));
  return { subjects: map(rows), availableSubjects: map(available) };
}
