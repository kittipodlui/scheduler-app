import type { StudyItemKind } from './subjects';

export type AnalyticsSubject = {
  key: string;
  label: string;
  kind: StudyItemKind;
  color: string;
  weight: number;
  targetPercent: number;
  plannedHours: number;
  completedHours: number;
  completionPercent: number;
};

export type AnalyticsActivityCategory = {
  activityType: 'study' | 'homework' | 'project' | 'review' | null;
  itemCount: number;
  completedCount: number;
  plannedHours: number;
  completedHours: number;
};

export type AnalyticsDay = {
  dayIndex: number;
  plannedHours: number;
  completedHours: number;
  completionPercent: number;
};

export type CategoryAnalytics = {
  categoryId: number;
  categoryName: string;
  scheduleSource: 'genetic' | 'manual' | 'mixed' | 'none';
  manualBlockCount: number;
  customizationCount: number;
  rescheduledCount: number;
  plannedHours: number;
  completedHours: number;
  completionPercent: number;
  completedTaskCount: number;
  taskCount: number;
  subjectCount: number;
  weeklyProgress: AnalyticsDay[];
  activityCategories: AnalyticsActivityCategory[];
  daysPerWeek?: number;
  sessionsPerDay?: number;
  startTime?: string;
  endTime?: string;
  subjects: AnalyticsSubject[];
};

export type AnalyticsWeeklyTrend = {
  weekStartDate: string;
  label: string;
  plannedSessions: number;
  completedSessions: number;
  completionPercent: number | null;
};

export type AnalyticsData = {
  categories: CategoryAnalytics[];
  weeklyTrend: AnalyticsWeeklyTrend[];
  summary: {
    categoryCount: number;
    manualBlockCount: number;
    customizationCount: number;
    plannedHours: number;
    completedHours: number;
    completionPercent: number;
    subjectCount: number;
    completedTaskCount: number;
    taskCount: number;
  };
};