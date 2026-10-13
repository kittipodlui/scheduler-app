export type StudyItemKind = 'subject' | 'activity';
export const SUBJECT_COLOR_OPTIONS = [
  { label: 'เขียว', value: '#28735b' },
  { label: 'น้ำเงิน', value: '#3979a8' },
  { label: 'ส้ม', value: '#d07842' },
  { label: 'เขียวอ่อน', value: '#548b68' },
  { label: 'ม่วง', value: '#8064a2' },
  { label: 'ชมพู', value: '#a25d74' },
  { label: 'ฟ้าอมเขียว', value: '#318b88' },
  { label: 'ทอง', value: '#c28a2c' },
  { label: 'เทา', value: '#64756d' },
] as const;
export const PRIORITY_WEIGHT_LEVELS = [10, 20, 25, 30] as const;
export type PriorityWeight = typeof PRIORITY_WEIGHT_LEVELS[number];

export function isSubjectColor(value: unknown): value is typeof SUBJECT_COLOR_OPTIONS[number]['value'] {
  return SUBJECT_COLOR_OPTIONS.some((option) => option.value === value);
}

export function isPriorityWeight(value: unknown): value is PriorityWeight {
  return PRIORITY_WEIGHT_LEVELS.some((level) => level === value);
}

export type SubjectPreference = {
  key: string;
  label: string;
  color: string;
  weight: PriorityWeight;
  kind: StudyItemKind;
  /** Marks a subject as belonging to one schedule week; it still participates in GA for that week. */
  manualOnly?: boolean;
  /** Completion state for legacy activity subjects without a study_activities row. */
  isCompleted?: boolean;
  scheduleOnlyDate?: string | null;
  futureNote: string;
  lectureNotes: string;
  activityDetails?: string;
  activityDurationHours?: number | null;
  activityStartDate?: string | null;
  activityEndDate?: string | null;
  activityStartTime?: string | null;
  activityEndTime?: string | null;
  activityCourseKey?: string | null;
};
