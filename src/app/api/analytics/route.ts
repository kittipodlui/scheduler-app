import type { RowDataPacket } from 'mysql2/promise';
import { getSessionUser } from '@/lib/auth';
import { getUserCategories } from '@/lib/categories';
import { ensureDatabase, getPool } from '@/lib/database';
import { getNormalizedWeightPercentages } from '@/lib/weight-percentages';
import type { SubjectPreference } from '@/lib/subjects';

export const runtime = 'nodejs';

type LatestScheduleRow = RowDataPacket & {
  id: number;
  days_per_week: number;
  sessions_per_day: number;
  start_time: string;
  end_time: string;
};

type SubjectHoursRow = RowDataPacket & {
  subject_key: string;
  label: string;
  kind: SubjectPreference['kind'];
  color: string;
  weight: number;
  planned_minutes: number;
  completed_minutes: number;
};

type ManualSummaryRow = RowDataPacket & { block_count: number };
type EventSummaryRow = RowDataPacket & { customization_count: number; rescheduled_count: number };
type DailyProgressRow = RowDataPacket & { dayIndex: number; plannedMinutes: number; completedMinutes: number };
type ActivityCategoryRow = RowDataPacket & {
  activityType: 'study' | 'homework' | 'project' | 'review' | null;
  itemCount: number;
  completedCount: number;
  plannedHours: number;
  completedHours: number;
};
type ActivityCountRow = RowDataPacket & { item_count: number; completed_count: number };
type WeeklyTrendRow = RowDataPacket & { weekStartDate: string; plannedSessions: number; completedSessions: number };

function isValidWeekStartDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  const [year, month, day] = value.split('-').map(Number);
  return date.getUTCFullYear() === year
    && date.getUTCMonth() + 1 === month
    && date.getUTCDate() === day
    && date.getUTCDay() === 1;
}

const ACTIVITY_WEEK_FILTER = `(
  ((start_date IS NOT NULL OR end_date IS NOT NULL)
    AND (start_date IS NULL OR start_date < DATE_ADD(?, INTERVAL 7 DAY))
    AND (end_date IS NULL OR end_date >= ?))
  OR (start_date IS NULL AND end_date IS NULL
    AND created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 7 DAY))
)`;

export async function GET(request: Request): Promise<Response> {
  try {
    const pool = getPool();
    await ensureDatabase(pool);
    const user = await getSessionUser(request, pool);
    if (!user) return Response.json({ error: 'กรุณาเข้าสู่ระบบ' }, { status: 401 });

    const requestedWeekStartDate = new URL(request.url).searchParams.get('weekStartDate');
    const [weekBounds] = await pool.query<RowDataPacket[]>(
      "SELECT DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY), '%Y-%m-%d') AS currentWeekStart",
    );
    const weekStartDate = requestedWeekStartDate ?? String(weekBounds[0]?.currentWeekStart ?? new Date().toISOString().slice(0, 10));
    if (!isValidWeekStartDate(weekStartDate)) {
      return Response.json({ error: 'สัปดาห์ไม่ถูกต้อง ต้องเลือกวันจันทร์ในรูปแบบ YYYY-MM-DD' }, { status: 400 });
    }

    const categories = await getUserCategories(pool, user.id);
    const analytics = [];
    for (const category of categories) {
      const [[schedules], [manualSummary], [eventSummary]] = await Promise.all([
        pool.execute<LatestScheduleRow[]>(
          'SELECT id, days_per_week, sessions_per_day, start_time, end_time FROM schedules WHERE user_id = ? AND category_id = ? AND week_start_date = ? ORDER BY id DESC LIMIT 1',
          [user.id, category.id, weekStartDate],
        ),
        pool.execute<ManualSummaryRow[]>(
          'SELECT COUNT(id) AS block_count FROM manual_study_blocks WHERE user_id = ? AND category_id = ? AND (scheduled_date IS NULL OR (scheduled_date >= ? AND scheduled_date < DATE_ADD(?, INTERVAL 7 DAY)))',
          [user.id, category.id, weekStartDate, weekStartDate],
        ),
        pool.execute<EventSummaryRow[]>(
          "SELECT SUM(event_type IN ('session_customized', 'manual_block_added', 'manual_block_removed')) AS customization_count, SUM(event_type = 'session_customized') AS rescheduled_count FROM study_schedule_events WHERE user_id = ? AND category_id = ? AND (schedule_id IN (SELECT id FROM schedules WHERE user_id = ? AND category_id = ? AND week_start_date = ?) OR (schedule_id IS NULL AND created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 7 DAY)))",
          [user.id, category.id, user.id, category.id, weekStartDate, weekStartDate, weekStartDate],
        ),
      ]);
      const latest = schedules[0];
      const [rows] = await pool.execute<SubjectHoursRow[]>(
        `SELECT subjects.subject_key, subjects.label, subjects.kind, subjects.color,
                preferences.weight, SUM(planned.planned_minutes) AS planned_minutes,
                SUM(planned.completed_minutes) AS completed_minutes
         FROM (
           SELECT subject_key, 60 AS planned_minutes, IF(is_completed = 1, 60, 0) AS completed_minutes
           FROM study_sessions WHERE schedule_id = ?
           UNION ALL
           SELECT subject_key, duration_minutes AS planned_minutes,
                  IF(is_completed = 1, duration_minutes, 0) AS completed_minutes
           FROM manual_study_blocks
           WHERE user_id = ? AND category_id = ?
             AND (scheduled_date IS NULL OR (scheduled_date >= ? AND scheduled_date < DATE_ADD(?, INTERVAL 7 DAY)))
         ) planned
         INNER JOIN subjects ON subjects.subject_key = planned.subject_key
         INNER JOIN user_subject_preferences preferences
           ON preferences.subject_key = subjects.subject_key AND preferences.user_id = ?
         GROUP BY subjects.subject_key, subjects.label, subjects.kind, subjects.color, preferences.weight
         ORDER BY subjects.sort_order, subjects.label`,
        [latest?.id ?? 0, user.id, category.id, weekStartDate, weekStartDate, user.id],
      );
      const academicRows = rows.filter((row) => row.kind === 'subject');
      const weightShares = getNormalizedWeightPercentages(academicRows.map((row) => ({ weight: row.weight } as SubjectPreference)));
      const targetPercentByKey = new Map(academicRows.map((row, index) => [row.subject_key, weightShares[index] ?? 0]));
      const subjects = rows.map((row) => {
        const plannedHours = Number((Number(row.planned_minutes) / 60).toFixed(2));
        const completedHours = Number((Number(row.completed_minutes) / 60).toFixed(2));
        return {
          key: row.subject_key,
          label: row.label,
          kind: row.kind,
          color: row.color,
          weight: row.weight,
          targetPercent: targetPercentByKey.get(row.subject_key) ?? 0,
          plannedHours,
          completedHours,
          completionPercent: plannedHours > 0 ? Math.round((completedHours / plannedHours) * 100) : 0,
        };
      });
      const plannedHours = subjects.reduce((total, subject) => total + subject.plannedHours, 0);
      const completedHours = subjects.reduce((total, subject) => total + subject.completedHours, 0);
      const manualBlockCount = Number(manualSummary[0]?.block_count ?? 0);
      const customizationCount = Number(eventSummary[0]?.customization_count ?? 0);
      const rescheduledCount = Number(eventSummary[0]?.rescheduled_count ?? 0);
      const [[dailyRows], [activityCategoryRows], [activityCounts]] = await Promise.all([
        pool.execute<DailyProgressRow[]>(
          `SELECT dayIndex, SUM(plannedMinutes) AS plannedMinutes, SUM(completedMinutes) AS completedMinutes
           FROM (
             SELECT day_index AS dayIndex, 60 AS plannedMinutes, IF(is_completed = 1, 60, 0) AS completedMinutes
             FROM study_sessions WHERE schedule_id = ?
             UNION ALL
             SELECT day_index AS dayIndex, duration_minutes AS plannedMinutes,
                    IF(is_completed = 1, duration_minutes, 0) AS completedMinutes
             FROM manual_study_blocks
             WHERE user_id = ? AND category_id = ?
               AND (scheduled_date IS NULL OR (scheduled_date >= ? AND scheduled_date < DATE_ADD(?, INTERVAL 7 DAY)))
           ) daily_items GROUP BY dayIndex`,
          [latest?.id ?? 0, user.id, category.id, weekStartDate, weekStartDate],
        ),
        pool.execute<ActivityCategoryRow[]>(
          `SELECT activity_type AS activityType, COUNT(*) AS itemCount,
                  SUM(is_completed = 1) AS completedCount,
                  SUM(duration_hours) AS plannedHours,
                  SUM(IF(is_completed = 1, duration_hours, 0)) AS completedHours
           FROM study_activities WHERE user_id = ? AND category_id = ? AND ${ACTIVITY_WEEK_FILTER} GROUP BY activity_type`,
          [user.id, category.id, weekStartDate, weekStartDate, weekStartDate, weekStartDate],
        ),
        pool.execute<ActivityCountRow[]>(
          `SELECT COUNT(*) AS item_count, SUM(is_completed = 1) AS completed_count FROM study_activities WHERE user_id = ? AND category_id = ? AND ${ACTIVITY_WEEK_FILTER}`,
          [user.id, category.id, weekStartDate, weekStartDate, weekStartDate, weekStartDate],
        ),
      ]);
      const weeklyProgress = Array.from({ length: 7 }, (_, dayIndex) => {
        const day = dailyRows.find((row) => Number(row.dayIndex) === dayIndex);
        const dayPlannedHours = Number(day?.plannedMinutes ?? 0) / 60;
        const dayCompletedHours = Number(day?.completedMinutes ?? 0) / 60;
        return {
          dayIndex,
          plannedHours: Number(dayPlannedHours.toFixed(2)),
          completedHours: Number(dayCompletedHours.toFixed(2)),
          completionPercent: dayPlannedHours > 0 ? Math.round((dayCompletedHours / dayPlannedHours) * 100) : 0,
        };
      });
      const activityCategories = activityCategoryRows.map((row) => ({
        activityType: row.activityType,
        itemCount: Number(row.itemCount),
        completedCount: Number(row.completedCount ?? 0),
        plannedHours: Number(Number(row.plannedHours).toFixed(2)),
        completedHours: Number(Number(row.completedHours ?? 0).toFixed(2)),
      }));
      const scheduleSource = latest
        ? manualBlockCount ? 'mixed' : 'genetic'
        : manualBlockCount ? 'manual' : 'none';
      analytics.push({
        categoryId: category.id,
        categoryName: category.name,
        scheduleSource: scheduleSource as 'genetic' | 'manual' | 'mixed' | 'none',
        manualBlockCount,
        customizationCount,
        plannedHours,
        completedHours,
        completionPercent: plannedHours > 0 ? Math.round((completedHours / plannedHours) * 100) : 0,
        weeklyProgress,
        activityCategories,
        completedTaskCount: Number(activityCounts[0]?.completed_count ?? 0),
        taskCount: Number(activityCounts[0]?.item_count ?? 0),
        subjectCount: subjects.filter((subject) => subject.kind === 'subject').length,
        rescheduledCount,
        ...(latest ? {
          daysPerWeek: latest.days_per_week,
          sessionsPerDay: latest.sessions_per_day,
          startTime: latest.start_time.slice(0, 5),
          endTime: latest.end_time.slice(0, 5),
        } : {}),
        subjects,
      });
    }

    const totals = analytics.reduce((summary, category) => ({
      plannedHours: summary.plannedHours + category.plannedHours,
      completedHours: summary.completedHours + category.completedHours,
      manualBlockCount: summary.manualBlockCount + category.manualBlockCount,
      customizationCount: summary.customizationCount + category.customizationCount,
    }), { plannedHours: 0, completedHours: 0, manualBlockCount: 0, customizationCount: 0 });
    const [weeklyTrendRows] = await pool.execute<WeeklyTrendRow[]>(
      `SELECT DATE_FORMAT(s.week_start_date, '%Y-%m-%d') AS weekStartDate,
              COUNT(ss.id) AS plannedSessions,
              SUM(IF(ss.is_completed = 1, 1, 0)) AS completedSessions
       FROM schedules s
       INNER JOIN study_sessions ss ON ss.schedule_id = s.id
       WHERE s.user_id = ?
         AND s.week_start_date >= DATE_SUB(?, INTERVAL 7 WEEK)
         AND s.week_start_date <= ?
         AND s.id = (
           SELECT MAX(s2.id)
           FROM schedules s2
           WHERE s2.user_id = s.user_id
             AND s2.category_id = s.category_id
             AND s2.week_start_date = s.week_start_date
         )
       GROUP BY s.week_start_date
       ORDER BY s.week_start_date ASC`,
      [user.id, weekStartDate, weekStartDate],
    );
    const [year, month, day] = weekStartDate.split('-').map(Number);
    const currentMonday = new Date(Date.UTC(year, month - 1, day));
    const weeklyTrend = Array.from({ length: 8 }, (_, index) => {
      const weekDate = new Date(currentMonday);
      weekDate.setUTCDate(weekDate.getUTCDate() - (7 - index) * 7);
      const weekStartDate = weekDate.toISOString().slice(0, 10);
      const row = weeklyTrendRows.find((item) => item.weekStartDate === weekStartDate);
      const plannedSessions = Number(row?.plannedSessions ?? 0);
      const completedSessions = Number(row?.completedSessions ?? 0);
      return {
        weekStartDate,
        label: `${weekDate.getUTCDate()}/${weekDate.getUTCMonth() + 1}`,
        plannedSessions,
        completedSessions,
        completionPercent: plannedSessions > 0
          ? Math.round((completedSessions / plannedSessions) * 100)
          : null,
      };
    });

    return Response.json({
      weekStartDate,
      categories: analytics,
      weeklyTrend,
      summary: {
        categoryCount: analytics.filter((category) => category.subjectCount > 0 || category.taskCount > 0 || category.plannedHours > 0 || category.manualBlockCount > 0).length,
        subjectCount: analytics.reduce((total, category) => total + category.subjectCount, 0),
        completedTaskCount: analytics.reduce((total, category) => total + category.completedTaskCount, 0),
        taskCount: analytics.reduce((total, category) => total + category.taskCount, 0),
        manualBlockCount: totals.manualBlockCount,
        customizationCount: totals.customizationCount,
        plannedHours: totals.plannedHours,
        completedHours: totals.completedHours,
        completionPercent: totals.plannedHours > 0
          ? Math.round((totals.completedHours / totals.plannedHours) * 100)
          : 0,
      },
    });
  } catch (error) {
    console.error('Analytics error:', error instanceof Error ? error.message : 'Unknown error');
    return Response.json({ error: 'โหลด analytics ไม่สำเร็จ' }, { status: 500 });
  }
}