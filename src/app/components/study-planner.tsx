"use client";

import { useCallback, useEffect, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import {
  PRIORITY_WEIGHT_LEVELS,
  SUBJECT_COLOR_OPTIONS,
  type PriorityWeight,
  type SubjectPreference,
  type StudyItemKind,
} from "@/lib/subjects";
import { getSessionTimeRange, getStudyDayTimeline } from "@/lib/study-time";
import { getNormalizedWeightPercentages } from "@/lib/weight-percentages";
import ManualScheduleEditor, {
  type ManualBlock,
} from "./manual-schedule-editor";
import AppNavigation from "./app-navigation";
import type { AlgorithmSampleBenchmarkReport } from "@/lib/algorithm-benchmarks";

type Session = {
  id: number;
  dayIndex: number;
  sessionIndex: number;
  subjectKey: string;
  isCompleted: boolean;
  futureNote: string;
  lectureNotes: string;
};

type Schedule = {
  id: number;
  weekStartDate: string;
  daysPerWeek: number;
  sessionsPerDay: number;
  startTime: string;
  endTime: string;
  createdAt: string;
  sessions: Session[];
};

type OtherCategoryMonthlyMark = {
  categoryId: number;
  categoryName: string;
  dateKey: string;
};

type AlgorithmComparison = {
  runsPerStochasticMethod: number;
  sessionCount: number;
  targetAllocation: Array<{
    key: string;
    label: string;
    weight: number;
    targetSessions: number;
  }>;
  results: Array<{
    algorithm: "Genetic Algorithm (Original)" | "Genetic Algorithm (Improved)" | "Greedy" | "Rule-based" | "Random";
    runs: number;
    meanPenalty: number;
    bestPenalty: number;
    meanFitnessScore: number;
    bestFitnessScore: number;
    penaltyStandardDeviation: number;
    meanRuntimeMs: number;
    meanTargetDeviation: number;
    meanAdjacentRepeats: number;
    meanSameTimeRepeats: number;
  }>;
};

type StudyCategory = {
  id: number;
  name: string;
};

type StudyCourse = {
  key: string;
  label: string;
};

type StudyActivity = {
  id: number | string;
  subjectKey?: string | null;
  activityType?: "study" | "homework" | "project" | "review" | null;
  courseKey: string | null;
  title: string;
  details: string;
  weight: number;
  durationHours: number;
  startDate: string | null;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
  isCompleted: boolean;
};

const dayNames = [
  "จันทร์",
  "อังคาร",
  "พุธ",
  "พฤหัสบดี",
  "ศุกร์",
  "เสาร์",
  "อาทิตย์",
];

// Stable per-category color using the database ID, with enough hue variations for all user-created plans.
function getCategoryPlanColor(categoryId: number | null): string {
  if (categoryId === null || !Number.isFinite(categoryId)) return "hsl(205 62% 42%)";
  const hue = (Math.abs(Math.trunc(categoryId)) * 137.508) % 360;
  return `hsl(${hue.toFixed(1)} 62% 42%)`;
}

function getWeekStartDate(offset: number): string {
  const date = new Date();
  const mondayOffset = (date.getDay() + 6) % 7;

  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - mondayOffset + offset * 7);

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return year + "-" + month + "-" + day;
}

function getWeekStartDateForKey(dateKey: string): string {
  const date = new Date(dateKey + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

function isValidWeekStartDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00Z");
  return !Number.isNaN(date.getTime())
    && date.toISOString().slice(0, 10) === value
    && getWeekStartDateForKey(value) === value;
}

function getMonthDate(offset: number): Date {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return new Date(date.getFullYear(), date.getMonth() + offset, 1);
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return year + "-" + month + "-" + day;
}

function getCalendarStartDate(monthOffsetValue: number): Date {
  const firstDay = getMonthDate(monthOffsetValue);
  const mondayOffset = (firstDay.getDay() + 6) % 7;
  return new Date(
    firstDay.getFullYear(),
    firstDay.getMonth(),
    firstDay.getDate() - mondayOffset,
  );
}

function getCalendarDateKeys(monthOffsetValue: number): string[] {
  const startDate = getCalendarStartDate(monthOffsetValue);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + index);
    return formatLocalDate(date);
  });
}

function getWeekOffsetForDate(date: Date): number {
  // Compare against this week's Monday, not the first week shown in the month.
  // This prevents clicking a date such as the 19th from loading the wrong week.
  const current = new Date();
  current.setHours(0, 0, 0, 0);
  current.setDate(current.getDate() - ((current.getDay() + 6) % 7));

  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  target.setHours(0, 0, 0, 0);
  target.setDate(target.getDate() - ((target.getDay() + 6) % 7));

  return Math.round(
    (target.getTime() - current.getTime()) / (7 * 24 * 60 * 60 * 1000),
  );
}

function SubjectColorPicker({
  color,
  disabled = false,
  onChange,
  label,
}: {
  color: string;
  disabled?: boolean;
  onChange: (color: (typeof SUBJECT_COLOR_OPTIONS)[number]["value"]) => void;
  label: string;
}) {
  const selectedColor =
    SUBJECT_COLOR_OPTIONS.find((option) => option.value === color) ??
    SUBJECT_COLOR_OPTIONS[0];

  return (
    <details className="subject-color-picker">
      <summary
        className="subject-color-picker-current"
        aria-label={label}
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : undefined}
        onClick={(event) => {
          if (disabled) event.preventDefault();
        }}
      >
        <span
          className="subject-color-preview"
          style={{ "--subject-color": selectedColor.value } as CSSProperties}
        />
        <span>{selectedColor.label}</span>
        <span className="subject-color-picker-arrow" aria-hidden="true">
          ▾
        </span>
      </summary>
      <div className="subject-color-options" role="group" aria-label="เลือกสี">
        {SUBJECT_COLOR_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className="subject-color-option"
            aria-pressed={option.value === color}
            disabled={disabled}
            onClick={(event) => {
              onChange(option.value);
              event.currentTarget.closest("details")?.removeAttribute("open");
            }}
          >
            <span
              className="subject-color-preview"
              style={{ "--subject-color": option.value } as CSSProperties}
            />
            <span>{option.label}</span>
          </button>
        ))}
      </div>
    </details>
  );
}

export default function StudyPlanner({
  openActivity = false,
}: {
  openActivity?: boolean;
}) {
  const [categories, setCategories] = useState<StudyCategory[]>([]);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [categoryName, setCategoryName] = useState("");
  const [renamedCategoryName, setRenamedCategoryName] = useState("");
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [isRenamingCategory, setIsRenamingCategory] = useState(false);
  const [isSavingCategoryName, setIsSavingCategoryName] = useState(false);
  const [isDeletingCategory, setIsDeletingCategory] = useState(false);
  const [isActivityModalOpen, setIsActivityModalOpen] = useState(openActivity);
  const [autoOpenActivity, setAutoOpenActivity] = useState(openActivity);
  const [isManualScheduleModalOpen, setIsManualScheduleModalOpen] =
    useState(false);
  const [activityName, setActivityName] = useState("");
  const [activityType, setActivityType] = useState<
    "study" | "homework" | "project" | "review"
  >("study");
  const [activityCourseKey, setActivityCourseKey] = useState("");
  const [activityDetails, setActivityDetails] = useState("");
  const [activityDuration, setActivityDuration] = useState("1");
  const [activityStartDate, setActivityStartDate] = useState("");
  const [activityEndDate, setActivityEndDate] = useState("");
  const [activityStartTime, setActivityStartTime] = useState("18:00");
  const [activityEndTime, setActivityEndTime] = useState("19:00");
  const [openSessionNoteId, setOpenSessionNoteId] = useState<number | null>(
    null,
  );
  const [subjectNoteType, setSubjectNoteType] = useState<"future" | "lecture">(
    "future",
  );
  const [subjectNoteDraft, setSubjectNoteDraft] = useState("");
  const [isSavingSubjectNote, setIsSavingSubjectNote] = useState(false);
  const [lecturePreview, setLecturePreview] = useState<{
    title: string;
    subtitle: string;
    content: string;
  } | null>(null);
  const [subjects, setSubjects] = useState<SubjectPreference[]>([]);
  const [availableSubjects, setAvailableSubjects] = useState<
    SubjectPreference[]
  >([]);
  const [newSubjectName, setNewSubjectName] = useState("");
  const [newSubjectWeight, setNewSubjectWeight] = useState<PriorityWeight>(20);
  const [newSubjectColor, setNewSubjectColor] =
    useState<(typeof SUBJECT_COLOR_OPTIONS)[number]["value"]>("#3979a8");
  const [selectedAvailableSubjectKey, setSelectedAvailableSubjectKey] =
    useState("");
  const [isAddingSubject, setIsAddingSubject] = useState(false);
  const [savingColorKey, setSavingColorKey] = useState<string | null>(null);
  const [activityCourses, setActivityCourses] = useState<StudyCourse[]>([]);
  const [activities, setActivities] = useState<StudyActivity[]>([]);
  const [manualStudyBlocks, setManualStudyBlocks] = useState<ManualBlock[]>([]);
  const handleManualBlocksUpdated = useCallback((blocks: ManualBlock[]) => {
    setManualStudyBlocks(blocks);
  }, []);
  const [deletingActivityId, setDeletingActivityId] = useState<string | null>(
    null,
  );
  const [savingActivityStatusId, setSavingActivityStatusId] = useState<string | null>(null);
  const [daysPerWeek, setDaysPerWeek] = useState(5);
  const [startTime, setStartTime] = useState("08:00");
  const [endTime, setEndTime] = useState("10:00");
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isComparingAlgorithms, setIsComparingAlgorithms] = useState(false);
  const [algorithmComparison, setAlgorithmComparison] = useState<AlgorithmComparison | null>(null);
  const [algorithmComparisonError, setAlgorithmComparisonError] = useState("");
  const [sampleBenchmark, setSampleBenchmark] = useState<AlgorithmSampleBenchmarkReport | null>(null);
  const [isRunningSampleBenchmark, setIsRunningSampleBenchmark] = useState(false);
  const [sampleBenchmarkError, setSampleBenchmarkError] = useState("");
  const [scheduleView, setScheduleView] = useState<
    "daily" | "weekly" | "monthly"
  >("weekly");
  const [selectedDayIndex, setSelectedDayIndex] = useState(0);
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<string | null>(null);
  const [manualEntryStartTime, setManualEntryStartTime] = useState<string | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const [monthOffset, setMonthOffset] = useState(0);
  const [monthSchedules, setMonthSchedules] = useState<
    Record<string, Schedule>
  >({});
  const [otherCategoryMonthlyMarks, setOtherCategoryMonthlyMarks] = useState<{
    scopeKey: string;
    marks: OtherCategoryMonthlyMark[];
  }>({ scopeKey: "", marks: [] });

  const handleCloseActivityModal = () => {
    // Closing temporarily keeps the draft so it can be resumed later.
    setIsActivityModalOpen(false);
    setAutoOpenActivity(false);
  };

  const resetActivityForm = () => {
    setActivityName("");
    setActivityType("study");
    setActivityCourseKey("");
    setActivityDetails("");
    setActivityDuration("1");
    setActivityStartDate("");
    setActivityEndDate("");
    setActivityStartTime("18:00");
    setActivityEndTime("19:00");
    setMessage("");
  };

  const handleCancelActivityModal = () => {
    resetActivityForm();
    handleCloseActivityModal();
  };

  const clearAlgorithmComparison = useCallback(() => {
    setAlgorithmComparison(null);
    setAlgorithmComparisonError("");
  }, []);

  const loadCategory = useCallback(
    async (nextCategoryId: number, requestedWeekStartDate: string) => {
      setCategoryId(nextCategoryId);
      try {
        window.localStorage.setItem("study-scheduler-default-category-id", String(nextCategoryId));
        window.localStorage.setItem("study-scheduler-default-week-start-date", requestedWeekStartDate);
      } catch {
        // Keep category and week navigation usable if browser storage is unavailable.
      }
      clearAlgorithmComparison();
      setIsLoading(true);
      setSchedule(null);
      try {
        const response = await fetch(
          `/api/schedule?categoryId=${nextCategoryId}&weekStartDate=${encodeURIComponent(requestedWeekStartDate)}`,
        );
        if (response.status === 401) {
          window.location.replace("/login");
          return;
        }
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "โหลดหมวดไม่สำเร็จ");
        setSubjects(data.subjects);
        setAvailableSubjects(data.availableSubjects ?? []);
        const loadedSchedule = data.schedule as Schedule | null;
        // Keep every saved week exactly as stored in MySQL, including the old 22:00 end time.
        // Only an unscheduled week receives the fresh 08:00–10:00 defaults.
        setSchedule(loadedSchedule);

        const loadedSubjects = data.subjects as SubjectPreference[];
        const activityScopeDate =
          loadedSubjects.length === 0 ||
          loadedSubjects.some(
            (subject) => subject.scheduleOnlyDate === requestedWeekStartDate,
          )
            ? requestedWeekStartDate
            : null;
        const activityParams = new URLSearchParams({
          categoryId: String(nextCategoryId),
        });
        if (activityScopeDate) {
          activityParams.set("scheduleOnlyDate", activityScopeDate);
        }
        const activityResponse = await fetch(
          `/api/study-activities?${activityParams.toString()}`,
        );
        const activityData = activityResponse.ok
          ? await activityResponse.json()
          : { activities: [], courses: [] };
        const apiActivities = (activityData.activities ??
          []) as StudyActivity[];
        setActivityCourses((activityData.courses ?? []) as StudyCourse[]);
        const activitySubjects = (data.subjects as SubjectPreference[])
          .filter((subject) => subject.kind === "activity")
          .map((subject) => ({
            id: `subject:${subject.key}`,
            subjectKey: subject.key,
            courseKey: subject.activityCourseKey ?? null,
            title: subject.label,
            details: subject.activityDetails ?? "",
            weight: Number(subject.weight),
            durationHours: subject.activityDurationHours ?? 0,
            startDate: subject.activityStartDate ?? null,
            endDate: subject.activityEndDate ?? null,
            startTime: subject.activityStartTime ?? null,
            endTime: subject.activityEndTime ?? null,
            isCompleted: Boolean(subject.isCompleted),
          }));
        const activityIdentity = (activity: StudyActivity) =>
          [
            activity.title,
            activity.courseKey,
            activity.startDate,
            activity.endDate,
            activity.startTime?.slice(0, 5),
            activity.endTime?.slice(0, 5),
          ]
            .map((value) => value ?? "")
            .join("|");
        const existingActivitySubjectKeys = new Set(
          apiActivities.flatMap((activity) =>
            activity.subjectKey ? [activity.subjectKey] : [],
          ),
        );
        const existingLegacyActivityIdentities = new Set(
          apiActivities
            .filter((activity) => !activity.subjectKey)
            .map(activityIdentity),
        );
        setActivities([
          ...apiActivities,
          ...activitySubjects.filter(
            (activity) =>
              !existingActivitySubjectKeys.has(activity.subjectKey!) &&
              !existingLegacyActivityIdentities.has(activityIdentity(activity)),
          ),
        ]);
        const nextDaysPerWeek = data.schedule?.daysPerWeek ?? 5;
        setDaysPerWeek(nextDaysPerWeek);
        // Keep the clicked calendar date's weekday even on weeks with no schedule.
        setSelectedDayIndex((current) => Math.max(0, Math.min(6, current)));
        setStartTime(data.schedule?.startTime ?? "08:00");
        setEndTime(data.schedule?.endTime ?? "10:00");
        if (openActivity && autoOpenActivity) setIsActivityModalOpen(true);
        setMessage("");
      } catch (error) {
        setMessage(
          error instanceof Error ? error.message : "โหลดหมวดไม่สำเร็จ",
        );
        setSubjects([]);
      } finally {
        setIsLoading(false);
      }
    },
    [autoOpenActivity, clearAlgorithmComparison, openActivity],
  );

  useEffect(() => {
    fetch("/api/categories")
      .then(async (response) => {
        if (response.status === 401) {
          window.location.replace("/login");
          return;
        }
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "โหลดหมวดไม่สำเร็จ");
        setCategories(data.categories);
        let savedCategoryId = "";
        let savedWeekStartDate = "";
        try {
          savedCategoryId = window.localStorage.getItem("study-scheduler-default-category-id") ?? "";
          savedWeekStartDate = window.localStorage.getItem("study-scheduler-default-week-start-date") ?? "";
        } catch {
          // Fall back to the latest category/current week if browser storage is unavailable.
        }
        const preferredCategory = data.categories.find(
          (category: StudyCategory) => String(category.id) === savedCategoryId,
        );
        const defaultCategory = preferredCategory ?? data.categories[data.categories.length - 1];
        const initialWeekStartDate = isValidWeekStartDateKey(savedWeekStartDate)
          ? savedWeekStartDate
          : getWeekStartDate(0);
        setWeekOffset(getWeekOffsetForDate(new Date(initialWeekStartDate + "T00:00:00")));
        if (defaultCategory)
          await loadCategory(defaultCategory.id, initialWeekStartDate);
      })
      .catch((error: unknown) => {
        setMessage(
          error instanceof Error
            ? error.message
            : "เชื่อมต่อฐานข้อมูลไม่สำเร็จ",
        );
      })
      .finally(() => setIsLoading(false));
  }, [loadCategory]);

  async function addCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = categoryName.trim();
    if (!name || isAddingCategory) return;

    setIsAddingCategory(true);
    setMessage("กำลังสร้างหมวด...");
    try {
      const response = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (response.status === 401) {
        window.location.replace("/login");
        return;
      }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "สร้างหมวดไม่สำเร็จ");
      const newCategory = {
        ...data.category,
        id: Number(data.category.id),
      } as StudyCategory;
      setCategories((current) => [...current, newCategory]);
      setCategoryName("");
      await loadCategory(newCategory.id, getWeekStartDate(weekOffset));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "สร้างหมวดไม่สำเร็จ");
    } finally {
      setIsAddingCategory(false);
    }
  }

  async function renameCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (categoryId === null || isSavingCategoryName) return;
    const name = renamedCategoryName.trim();
    if (!name) return;

    setIsSavingCategoryName(true);
    setMessage("กำลังบันทึกชื่อหมวด...");
    try {
      const response = await fetch("/api/categories", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rename", categoryId, name }),
      });
      if (response.status === 401) {
        window.location.replace("/login");
        return;
      }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "แก้ไขชื่อหมวดไม่สำเร็จ");
      setCategories((current) =>
        current.map((category) =>
          category.id === categoryId
            ? { ...category, name: data.category.name }
            : category,
        ),
      );
      setRenamedCategoryName("");
      setIsRenamingCategory(false);
      setMessage("แก้ไขชื่อหมวดแล้ว");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "แก้ไขชื่อหมวดไม่สำเร็จ",
      );
    } finally {
      setIsSavingCategoryName(false);
    }
  }

  async function deleteCategory() {
    const selectedCategory = categories.find(
      (category) => category.id === categoryId,
    );
    if (
      !selectedCategory ||
      selectedCategory.name === "แผนการอ่านหนังสือ" ||
      isDeletingCategory
    )
      return;
    if (
      !window.confirm(
        `ลบหมวด "${selectedCategory.name}" และข้อมูลทั้งหมดในหมวดนี้หรือไม่?`,
      )
    )
      return;

    setIsDeletingCategory(true);
    setMessage("กำลังลบหมวด...");
    try {
      const response = await fetch("/api/categories", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId: selectedCategory.id }),
      });
      if (response.status === 401) {
        window.location.replace("/login");
        return;
      }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "ลบหมวดไม่สำเร็จ");
      setCategories(data.categories);
      setCategoryId(null);
      setSubjects([]);
      setAvailableSubjects([]);
      setActivities([]);
      setActivityCourses([]);
      setSchedule(null);
      setIsRenamingCategory(false);
      setMessage("");
      if (data.categories.length > 0)
        await loadCategory(Number(data.categories[0].id), getWeekStartDate(weekOffset));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "ลบหมวดไม่สำเร็จ");
    } finally {
      setIsDeletingCategory(false);
    }
  }

  function changeWeight(subjectKey: string, weight: PriorityWeight) {
    // Weight applies only to academic subjects, never activities.
    if (!subjects.some((subject) => subject.key === subjectKey && subject.kind === "subject")) {
      return;
    }
    clearAlgorithmComparison();
    setSubjects((current) =>
      current.map((subject) =>
        subject.key === subjectKey && subject.kind === "subject"
          ? { ...subject, weight }
          : subject,
      ),
    );
  }

  function openSessionNote(session: Session, type: "future" | "lecture") {
    setOpenSessionNoteId(session.id);
    setSubjectNoteType(type);
    setSubjectNoteDraft(
      type === "future" ? session.futureNote : session.lectureNotes,
    );
  }

  async function saveSessionNote(session: Session) {
    if (categoryId === null) return;
    setIsSavingSubjectNote(true);
    setMessage("กำลังบันทึกโน้ตช่วงเรียน...");
    const nextFutureNote =
      subjectNoteType === "future" ? subjectNoteDraft : session.futureNote;
    const nextLectureNotes =
      subjectNoteType === "lecture" ? subjectNoteDraft : session.lectureNotes;
    try {
      const response = await fetch("/api/schedule", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "notes",
          categoryId,
          scheduleId: schedule?.id,
          sessionId: session.id,
          futureNote: nextFutureNote,
          lectureNotes: nextLectureNotes,
        }),
      });
      if (response.status === 401) {
        window.location.replace("/login");
        return;
      }
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "บันทึกโน้ตช่วงเรียนไม่สำเร็จ");
      setSchedule(
        (current) =>
          current && {
            ...current,
            sessions: current.sessions.map((item) =>
              item.id === session.id
                ? {
                    ...item,
                    futureNote: nextFutureNote,
                    lectureNotes: nextLectureNotes,
                  }
                : item,
            ),
          },
      );
      setOpenSessionNoteId(null);
      setMessage("บันทึกโน้ตช่วงเรียนแล้ว");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "บันทึกโน้ตช่วงเรียนไม่สำเร็จ",
      );
    } finally {
      setIsSavingSubjectNote(false);
    }
  }

  function getCurrentSubjectScopeDate(): string | null {
    // Older schedules continue to use their original shared subject records.
    // A newly created weekly schedule owns a separate list of subjects/weights.
    if (schedule?.weekStartDate) {
      return subjects.some(
        (subject) => subject.scheduleOnlyDate === schedule.weekStartDate,
      )
        ? schedule.weekStartDate
        : null;
    }
    // A first-time/legacy setup can still have shared subjects before its first saved schedule.
    // Keep those in their original scope until the user has a saved GA week.
    if (
      [...subjects, ...availableSubjects].some(
        (subject) => !subject.scheduleOnlyDate,
      )
    ) {
      return null;
    }
    return selectedCalendarDate
      ? getWeekStartDateForKey(selectedCalendarDate)
      : getWeekStartDate(weekOffset);
  }

  async function updateSubject(
    item:
      | { subjectKey: string; color?: string }
      | { label: string; kind: StudyItemKind; weight?: PriorityWeight; color?: string },
    method: "POST" | "DELETE",
  ): Promise<boolean> {
    const scheduleOnlyDate = getCurrentSubjectScopeDate();
    setMessage(
      method === "DELETE" ? "กำลังนำรายการออก..." : "กำลังเพิ่มรายการ...",
    );
    try {
      const response = await fetch("/api/subjects", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...item, categoryId, scheduleOnlyDate }),
      });
      if (response.status === 401) {
        window.location.replace("/login");
        return false;
      }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "แก้ไขรายวิชาไม่สำเร็จ");
      setSubjects(data.subjects);
      setAvailableSubjects(data.availableSubjects ?? []);
      setSchedule(null);
      clearAlgorithmComparison();
      setMessage("");
      return true;
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "แก้ไขรายวิชาไม่สำเร็จ",
      );
      return false;
    }
  }

  async function addSubject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (categoryId === null || isAddingSubject) return;

    const label = newSubjectName.trim();
    if (selectedAvailableSubjectKey === "" && label === "") {
      setMessage("กรอกชื่อวิชาหรือเลือกรายวิชาจากรายการ");
      return;
    }

    setIsAddingSubject(true);
    try {
      const item = selectedAvailableSubjectKey
        ? { subjectKey: selectedAvailableSubjectKey, color: newSubjectColor }
        : {
            label,
            kind: "subject" as const,
            weight: newSubjectWeight,
            color: newSubjectColor,
          };
      if (!(await updateSubject(item, "POST"))) return;
      setNewSubjectName("");
      setSelectedAvailableSubjectKey("");
      setNewSubjectWeight(20);
      setNewSubjectColor("#3979a8");
    } finally {
      setIsAddingSubject(false);
    }
  }

  async function changeSubjectColor(
    subjectKey: string,
    color: (typeof SUBJECT_COLOR_OPTIONS)[number]["value"],
  ) {
    if (categoryId === null || savingColorKey !== null) return;
    setSavingColorKey(subjectKey);
    try {
      const response = await fetch("/api/subjects", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "color",
          categoryId,
          subjectKey,
          color,
          scheduleOnlyDate: getCurrentSubjectScopeDate(),
        }),
      });
      if (response.status === 401) {
        window.location.replace("/login");
        return;
      }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "เปลี่ยนสีวิชาไม่สำเร็จ");
      setSubjects(data.subjects);
      setAvailableSubjects(data.availableSubjects ?? []);
      setMessage("");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "เปลี่ยนสีวิชาไม่สำเร็จ",
      );
    } finally {
      setSavingColorKey(null);
    }
  }

  function openNewActivityForm() {
    setMessage("");
    setIsActivityModalOpen(true);
  }

  async function addDetailedActivity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const label = activityName.trim();
    if (!label || categoryId === null) return;
    setMessage("กำลังเพิ่มกิจกรรม...");
    try {
      const response = await fetch("/api/study-activities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categoryId,
          scheduleOnlyDate: getCurrentSubjectScopeDate(),
          title: label,
          activityType,
          courseKey: activityCourseKey || null,
          weight: 20,
          details: activityDetails,
          durationHours: Number(activityDuration),
          startDate: activityStartDate || null,
          endDate: activityEndDate || null,
          startTime: activityStartTime || null,
          endTime: activityEndTime || null,
        }),
      });
      if (response.status === 401) {
        window.location.replace("/login");
        return;
      }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "เพิ่มกิจกรรมไม่สำเร็จ");
      setSubjects(data.subjects);
      setActivityCourses((data.courses ?? []) as StudyCourse[]);
      setActivities((current) =>
        data.activity ? [...current, data.activity] : current,
      );
      setActivityName("");
      setActivityType("study");
      setActivityCourseKey("");
      setActivityDetails("");
      setActivityDuration("1");
      setActivityStartDate("");
      setActivityEndDate("");
      setActivityStartTime("18:00");
      setActivityEndTime("19:00");
      handleCloseActivityModal();
      setMessage("เพิ่มกิจกรรมแล้ว");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "เพิ่มกิจกรรมไม่สำเร็จ",
      );
    }
  }

  async function toggleActivityCompletion(activity: StudyActivity) {
    if (categoryId === null || savingActivityStatusId !== null) return;

    const activityId = String(activity.id);
    const nextIsCompleted = !activity.isCompleted;
    setSavingActivityStatusId(activityId);
    setMessage("");

    try {
      const body: {
        action: "completion";
        categoryId: number;
        isCompleted: boolean;
        activityId?: number;
        subjectKey?: string;
      } = { action: "completion", categoryId, isCompleted: nextIsCompleted };

      if (typeof activity.id === "number" || /^\d+$/.test(activityId)) {
        body.activityId = Number(activity.id);
      } else if (activity.subjectKey) {
        body.subjectKey = activity.subjectKey;
      } else {
        throw new Error("ไม่พบรหัสกิจกรรมที่ต้องการเปลี่ยนสถานะ");
      }

      const response = await fetch("/api/study-activities", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (response.status === 401) {
        window.location.replace("/login");
        return;
      }
      const data = (await response.json()) as {
        activity?: { id: number | string; isCompleted: boolean };
        error?: string;
      };
      if (!response.ok || !data.activity) {
        throw new Error(data.error || "เปลี่ยนสถานะกิจกรรมไม่สำเร็จ");
      }

      setActivities((current) => current.map((item) =>
        String(item.id) === activityId
          ? { ...item, isCompleted: Boolean(data.activity?.isCompleted) }
          : item,
      ));
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "เปลี่ยนสถานะกิจกรรมไม่สำเร็จ");
    } finally {
      setSavingActivityStatusId(null);
    }
  }

  async function deleteActivity(activity: StudyActivity) {
    if (categoryId === null) return;

    const activityId = String(activity.id);
    setDeletingActivityId(activityId);
    setMessage("");
    try {
      const params = new URLSearchParams({ categoryId: String(categoryId) });
      const scheduleOnlyDate = getCurrentSubjectScopeDate();
      if (scheduleOnlyDate) params.set("scheduleOnlyDate", scheduleOnlyDate);
      if (typeof activity.id === "number" || /^\d+$/.test(activityId)) {
        params.set("activityId", activityId);
      } else if (activity.subjectKey) {
        params.set("subjectKey", activity.subjectKey);
      } else {
        throw new Error("ไม่พบรหัสกิจกรรมที่ต้องการลบ");
      }
      const response = await fetch(`/api/study-activities?${params}`, {
        method: "DELETE",
      });
      if (response.status === 401) {
        window.location.replace("/login");
        return;
      }
      const data = (await response.json()) as {
        error?: string;
        subjectKey?: string | null;
        subjects?: SubjectPreference[];
        availableSubjects?: SubjectPreference[];
      };
      if (!response.ok) throw new Error(data.error || "ลบกิจกรรมไม่สำเร็จ");

      setActivities((current) =>
        current.filter((item) => String(item.id) !== activityId),
      );
      setSubjects(data.subjects ?? []);
      setAvailableSubjects(data.availableSubjects ?? []);
      if (data.subjectKey) {
        setSchedule((current) =>
          current
            ? {
                ...current,
                sessions: current.sessions.filter(
                  (session) => session.subjectKey !== data.subjectKey,
                ),
              }
            : current,
        );
      }
      setMessage("ลบกิจกรรมแล้ว");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "ลบกิจกรรมไม่สำเร็จ");
    } finally {
      setDeletingActivityId(null);
    }
  }

  async function customizeSessionSubject(session: Session, subjectKey: string) {
    if (!schedule || categoryId === null || subjectKey === session.subjectKey)
      return;
    const response = await fetch("/api/schedule", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "subject",
        categoryId,
        scheduleId: schedule.id,
        sessionId: session.id,
        subjectKey,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.error || "ปรับวิชาในตารางไม่สำเร็จ");
      return;
    }
    setSchedule(
      (current) =>
        current && {
          ...current,
          sessions: current.sessions.map((item) =>
            item.id === session.id ? { ...item, subjectKey } : item,
          ),
        },
    );
    setMessage("บันทึกการปรับตารางแล้ว");
  }

  async function generateSchedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsGenerating(true);
    setMessage("กำลังคำนวณตาราง...");

    try {
      const response = await fetch("/api/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categoryId,
          // Send only the immutable subject key and chosen Weight. The API
          // resolves labels and ownership from MySQL for this exact week.
          subjects: autoScheduleSubjects.map((subject) => ({
            key: subject.key,
            weight: Number(subject.weight),
          })),
          daysPerWeek,
          startTime,
          endTime,
          weekStartDate: selectedCalendarDate
            ? getWeekStartDateForKey(selectedCalendarDate)
            : getWeekStartDate(weekOffset),
        }),
      });
      if (response.status === 401) {
        window.location.replace("/login");
        return;
      }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "สร้างตารางไม่สำเร็จ");
      setSubjects(data.subjects);
      setSchedule(data.schedule);
      setStartTime(data.schedule.startTime);
      setEndTime(data.schedule.endTime);
      setMessage("");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "สร้างตารางไม่สำเร็จ",
      );
    } finally {
      setIsGenerating(false);
    }
  }

  async function compareAlgorithms() {
    if (categoryId === null || isComparingAlgorithms || autoScheduleSubjects.length === 0) return;

    setIsComparingAlgorithms(true);
    setAlgorithmComparison(null);
    setAlgorithmComparisonError("");
    try {
      const response = await fetch("/api/schedule/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categoryId,
          subjects: autoScheduleSubjects.map((subject) => ({
            key: subject.key,
            weight: subject.weight,
          })),
          daysPerWeek,
          startTime,
          endTime,
          // Compare using the same subject scope as the current planner view.
          // Legacy/shared subjects use null; weekly subjects use their own Monday date.
          weekStartDate: getCurrentSubjectScopeDate(),
        }),
      });
      if (response.status === 401) {
        window.location.replace("/login");
        return;
      }
      const data = (await response.json()) as {
        comparison?: AlgorithmComparison;
        error?: string;
      };
      if (!response.ok || !data.comparison) {
        throw new Error(data.error || "เปรียบเทียบอัลกอริทึมไม่สำเร็จ");
      }
      setAlgorithmComparison(data.comparison);
    } catch (error) {
      setAlgorithmComparison(null);
      setAlgorithmComparisonError(
        error instanceof Error ? error.message : "เปรียบเทียบอัลกอริทึมไม่สำเร็จ",
      );
    } finally {
      setIsComparingAlgorithms(false);
    }
  }

  async function runSampleBenchmarks() {
    if (isRunningSampleBenchmark) return;
    setIsRunningSampleBenchmark(true);
    setSampleBenchmark(null);
    setSampleBenchmarkError("");
    try {
      const response = await fetch("/api/schedule/compare-samples", {
        method: "POST",
      });
      if (response.status === 401) {
        window.location.replace("/login");
        return;
      }
      const data = (await response.json()) as {
        report?: AlgorithmSampleBenchmarkReport;
        error?: string;
      };
      if (!response.ok || !data.report) {
        throw new Error(data.error || "ทดสอบข้อมูลตัวอย่างไม่สำเร็จ");
      }
      setSampleBenchmark(data.report);
    } catch (error) {
      setSampleBenchmark(null);
      setSampleBenchmarkError(
        error instanceof Error ? error.message : "ทดสอบข้อมูลตัวอย่างไม่สำเร็จ",
      );
    } finally {
      setIsRunningSampleBenchmark(false);
    }
  }

  async function updateSessionCompletion(
    session: Session,
    isCompleted: boolean,
  ) {
    if (!schedule || categoryId === null) return;
    const scheduleId = schedule.id;
    const selectedCategoryId = categoryId;
    setSchedule(
      (current) =>
        current && {
          ...current,
          sessions: current.sessions.map((item) =>
            item.id === session.id ? { ...item, isCompleted } : item,
          ),
        },
    );

    try {
      const response = await fetch("/api/schedule", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categoryId: selectedCategoryId,
          scheduleId,
          sessionId: session.id,
          isCompleted,
        }),
      });
      if (response.status === 401) {
        window.location.replace("/login");
        return;
      }
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "บันทึกความคืบหน้าไม่สำเร็จ");
      setMessage("");
    } catch (error) {
      setSchedule(
        (current) =>
          current && {
            ...current,
            sessions: current.sessions.map((item) =>
              item.id === session.id
                ? { ...item, isCompleted: session.isCompleted }
                : item,
            ),
          },
      );
      setMessage(
        error instanceof Error ? error.message : "บันทึกความคืบหน้าไม่สำเร็จ",
      );
    }
  }

  useEffect(() => {
    if (scheduleView !== "monthly" || categoryId === null) return;

    let cancelled = false;

    const loadMonthSchedules = async () => {
      setIsLoading(true);
      try {
        const startDate = getCalendarStartDate(monthOffset);
        const weekStarts = Array.from({ length: 6 }, (_, index) => {
          const date = new Date(startDate);
          date.setDate(startDate.getDate() + index * 7);
          return formatLocalDate(date);
        });

        const results = await Promise.all(
          weekStarts.map(async (weekStartDate) => {
            const response = await fetch(
              `/api/schedule?categoryId=${categoryId}&weekStartDate=${weekStartDate}`,
            );
            if (!response.ok) return [weekStartDate, null] as const;
            const data = await response.json();
            return [weekStartDate, data.schedule as Schedule | null] as const;
          }),
        );

        if (cancelled) return;

        const nextSchedules: Record<string, Schedule> = {};
        for (const [weekStartDate, nextSchedule] of results) {
          if (nextSchedule) nextSchedules[weekStartDate] = nextSchedule;
        }
        setMonthSchedules(nextSchedules);
      } catch {
        if (!cancelled) setMonthSchedules({});
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void loadMonthSchedules();

    return () => {
      cancelled = true;
    };
  }, [scheduleView, monthOffset, categoryId]);

  // Load other-category schedule markers only for the visible monthly calendar.
  useEffect(() => {
    if (scheduleView !== "monthly" || categoryId === null) return;

    const startDate = formatLocalDate(getCalendarStartDate(monthOffset));
    const scopeKey = String(categoryId) + ":" + startDate;
    let cancelled = false;

    async function loadOtherCategoryMonthlyMarks() {
      try {
        const response = await fetch(
          `/api/schedule/category-month-markers?categoryId=${categoryId}&startDate=${encodeURIComponent(startDate)}`,
          { cache: "no-store" },
        );
        if (response.status === 401) {
          window.location.replace("/login");
          return;
        }
        const data = await response.json() as {
          marks?: OtherCategoryMonthlyMark[];
          error?: string;
        };
        if (!response.ok) throw new Error(data.error || "โหลดจุดจากหมวดอื่นไม่สำเร็จ");
        if (cancelled) return;
        setOtherCategoryMonthlyMarks({ scopeKey, marks: data.marks ?? [] });
      } catch {
        if (!cancelled) setOtherCategoryMonthlyMarks({ scopeKey, marks: [] });
      }
    }

    void loadOtherCategoryMonthlyMarks();
    return () => {
      cancelled = true;
    };
  }, [scheduleView, categoryId, monthOffset]);

  const visibleOtherCategoryMonthlyMarks =
    scheduleView === "monthly" &&
    categoryId !== null &&
    otherCategoryMonthlyMarks.scopeKey ===
      String(categoryId) + ":" + formatLocalDate(getCalendarStartDate(monthOffset))
      ? otherCategoryMonthlyMarks.marks
      : [];
  const visibleOtherCategoryMonthlyPlans = Array.from(
    new Map(visibleOtherCategoryMonthlyMarks.map((mark) => [
      mark.categoryId,
      { categoryId: mark.categoryId, categoryName: mark.categoryName },
    ])).values(),
  );

  const totalSessions = schedule?.sessions.length ?? 0;
  const completedHours =
    schedule?.sessions.filter((session) => session.isCompleted).length ?? 0;
  const completionPercent =
    totalSessions > 0 ? Math.round((completedHours / totalSessions) * 100) : 0;
  const autoScheduleSubjects = subjects.filter(
    (subject) => subject.kind === "subject",
  );
  const weightPercentages =
    getNormalizedWeightPercentages(autoScheduleSubjects);
  const effectiveStartTime = schedule?.startTime ?? startTime;
  const effectiveEndTime = schedule?.endTime ?? endTime;
  const studyTimeline = getStudyDayTimeline(effectiveStartTime, effectiveEndTime);
  const pauseAfterSession = new Map(
    studyTimeline.breaks.map((studyBreak) => [
      studyBreak.afterSessionIndex,
      studyBreak.label,
    ]),
  );
  const weightPercentByKey = new Map(
    autoScheduleSubjects.map((subject, index) => [
      subject.key,
      weightPercentages[index] ?? 0,
    ]),
  );
  // Target allocation is calculated from academic subjects only.
  // Scheduled activities remain in the timetable but do not affect this distribution.
  const scheduledCounts = autoScheduleSubjects.map((subject) => {
    const automaticSessions =
      schedule?.sessions.filter(
        (session) => session.subjectKey === subject.key,
      ) ?? [];
    const manualSessions = manualStudyBlocks.filter(
      (block) =>
        block.subjectKind === "subject" && block.subjectKey === subject.key,
    );
    return {
      ...subject,
      targetPercent: weightPercentByKey.get(subject.key) ?? 0,
      count: automaticSessions.length + manualSessions.length,
      completedCount:
        automaticSessions.filter((session) => session.isCompleted).length +
        manualSessions.filter((block) => block.isCompleted).length,
    };
  });
  const totalTargetSessions = scheduledCounts.reduce(
    (total, subject) => total + subject.count,
    0,
  );
  const noteSession = schedule?.sessions.find(
    (session) => session.id === openSessionNoteId,
  );
  const noteSubject = noteSession
    ? subjects.find((subject) => subject.key === noteSession.subjectKey)
    : undefined;
  const visibleWeekStart = new Date();
  visibleWeekStart.setDate(
    visibleWeekStart.getDate() -
      ((visibleWeekStart.getDay() + 6) % 7) +
      weekOffset * 7,
  );
  const visibleWeekEnd = new Date(visibleWeekStart);
  visibleWeekEnd.setDate(visibleWeekStart.getDate() + 6);
  const weekRangeLabel =
    new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short" }).format(
      visibleWeekStart,
    ) +
    " – " +
    new Intl.DateTimeFormat("th-TH", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(visibleWeekEnd);

  const visibleMonth = getMonthDate(monthOffset);
  const monthLabel = new Intl.DateTimeFormat("th-TH", {
    month: "long",
    year: "numeric",
  }).format(visibleMonth);
  const calendarDateKeys = getCalendarDateKeys(monthOffset);

  return (
    <main className="app-shell study-planner-shell">
      <AppNavigation activePage="study-plan" />
      <header className="page-header">
        <div>
          <p className="eyebrow">ตารางเรียน</p>
          <h1>Schedule</h1>
          <p className="schedule-category-name">
            {categories.find((category) => category.id === categoryId)?.name ??
              "เลือกหมวดเพื่อดูตาราง"}
          </p>
        </div>
        <div className="header-actions schedule-header-actions">
          <div className="schedule-header-buttons">
            <button
              className="add-subject-button"
              type="button"
              onClick={openNewActivityForm}
              disabled={categoryId === null}
            >
              + เพิ่มกิจกรรม
            </button>
            <button
              className="manual-schedule-header-button"
              type="button"
              onClick={() => {
                setManualEntryStartTime(null);
                setIsManualScheduleModalOpen(true);
              }}
              disabled={categoryId === null}
            >
              + เพิ่มช่วงเรียนเอง
            </button>
          </div>
          {message && (
            <p className="connection-status" aria-live="polite">
              <span
                className={`status-dot ${message.includes("ไม่") ? "status-error" : ""}`}
              />
              {message}
            </p>
          )}
        </div>
      </header>

      <div className="workspace">
        <aside className="settings-panel">
          <div className="category-manager">
            <label className="category-manager-label" htmlFor="category-picker">
              หมวดหมู่แผน
            </label>
            {categories.length > 0 ? (
              <div
                className={`category-select-row ${categories.find((category) => category.id === categoryId)?.name === "แผนการอ่านหนังสือ" ? "category-select-row-fixed" : ""}`}
              >
                <select
                  id="category-picker"
                  value={categoryId ?? ""}
                  disabled={isLoading || isDeletingCategory}
                  onChange={(event) => {
                    const nextId = Number(event.target.value);
                    const selected = categories.find(
                      (category) => category.id === nextId,
                    );
                    if (selected) {
                      setIsRenamingCategory(false);
                      void loadCategory(nextId, getWeekStartDate(weekOffset));
                    }
                  }}
                >
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
                {categories.find((category) => category.id === categoryId)
                  ?.name !== "แผนการอ่านหนังสือ" && (
                  <>
                    <button
                      className="edit-category-button"
                      type="button"
                      disabled={isLoading || isDeletingCategory}
                      onClick={() => {
                        const selected = categories.find(
                          (category) => category.id === categoryId,
                        );
                        if (!selected) return;
                        setRenamedCategoryName(selected.name);
                        setIsRenamingCategory((current) => !current);
                      }}
                    >
                      {isRenamingCategory ? "ยกเลิก" : "แก้ชื่อ"}
                    </button>
                    <button
                      className="remove-category-button"
                      type="button"
                      disabled={isLoading || isDeletingCategory}
                      onClick={() => void deleteCategory()}
                    >
                      {isDeletingCategory ? "กำลังลบ..." : "ลบหมวด"}
                    </button>
                  </>
                )}
              </div>
            ) : (
              <p className="no-subjects">กำลังเตรียมแผนหลัก...</p>
            )}
            {isRenamingCategory && categoryId !== null && (
              <form className="category-add-row" onSubmit={renameCategory}>
                <label className="sr-only" htmlFor="renamed-category-name">
                  ชื่อหมวดใหม่
                </label>
                <input
                  id="renamed-category-name"
                  value={renamedCategoryName}
                  onChange={(event) =>
                    setRenamedCategoryName(event.target.value)
                  }
                  maxLength={60}
                  required
                />
                <button
                  className="add-subject-button"
                  type="submit"
                  disabled={isSavingCategoryName}
                >
                  {isSavingCategoryName ? "กำลังบันทึก..." : "บันทึกชื่อ"}
                </button>
              </form>
            )}
            <form className="category-add-row" onSubmit={addCategory}>
              <label className="sr-only" htmlFor="new-category-name">
                ชื่อหมวดหมู่ใหม่
              </label>
              <input
                id="new-category-name"
                value={categoryName}
                onChange={(event) => setCategoryName(event.target.value)}
                placeholder="ชื่อหมวดหมู่ใหม่"
                maxLength={60}
                required
              />
              <button
                className="add-subject-button"
                type="submit"
                disabled={isAddingCategory || categories.length >= 30}
              >
                {isAddingCategory ? "กำลังเพิ่ม..." : "เพิ่มหมวด"}
              </button>
            </form>
          </div>
          {categoryId === null ? null : (
            <>
              <div className="section-heading category-items-heading">
                <h2>รายการในหมวดนี้</h2>
                {autoScheduleSubjects.length > 0 && (
                  <span className="small-label">สัดส่วนวิชาใน GA รวม 100%</span>
                )}
              </div>
              <form className="custom-item-form" onSubmit={addSubject}>
                <label htmlFor="new-subject-name">เพิ่มรายวิชา</label>
                <div className="custom-item-row">
                  <label className="new-subject-field">
                    <span>Weight</span>
                    <select
                      className="new-subject-weight"
                      aria-label="น้ำหนักเริ่มต้นของรายวิชา"
                      value={newSubjectWeight}
                      onChange={(event) =>
                        setNewSubjectWeight(
                          Number(event.target.value) as PriorityWeight,
                        )
                      }
                    >
                      {PRIORITY_WEIGHT_LEVELS.map((weight) => (
                        <option key={weight} value={weight}>
                          {weight}%
                        </option>
                      ))}
                    </select>
                  </label>
                  <label
                    className="new-subject-field"
                    htmlFor="new-subject-name"
                  >
                    <span>ชื่อวิชา</span>
                    <input
                      id="new-subject-name"
                      value={newSubjectName}
                      onChange={(event) => {
                        setNewSubjectName(event.target.value);
                        setSelectedAvailableSubjectKey("");
                      }}
                      placeholder="ชื่อวิชาใหม่"
                      maxLength={60}
                      disabled={Boolean(selectedAvailableSubjectKey)}
                    />
                  </label>
                  <div className="subject-color-field new-subject-color-field">
                    <span>สีประจำวิชา</span>
                    <SubjectColorPicker
                      color={newSubjectColor}
                      label="เลือกสีประจำวิชาใหม่"
                      onChange={setNewSubjectColor}
                    />
                  </div>
                  <button
                    className="add-subject-button"
                    type="submit"
                    disabled={isAddingSubject || isLoading}
                  >
                    {isAddingSubject ? "กำลังเพิ่ม..." : "เพิ่มวิชา"}
                  </button>
                </div>
                {availableSubjects.filter(
                  (subject) => subject.kind === "subject",
                ).length > 0 && (
                  <label className="available-subject-field">
                    หรือเพิ่มวิชาที่เคยสร้างไว้กลับเข้าหมวด
                    <select
                      value={selectedAvailableSubjectKey}
                      onChange={(event) => {
                        setSelectedAvailableSubjectKey(event.target.value);
                        if (event.target.value) setNewSubjectName("");
                      }}
                    >
                      <option value="">เลือกวิชาที่เคยสร้างไว้</option>
                      {availableSubjects
                        .filter((subject) => subject.kind === "subject")
                        .map((subject) => (
                          <option key={subject.key} value={subject.key}>
                            {subject.label}
                          </option>
                        ))}
                    </select>
                  </label>
                )}
              </form>
              <div>
                <fieldset className="subject-list">
                  <legend className="sr-only">
                    รายการวิชาในหมวดนี้
                  </legend>
                  {autoScheduleSubjects.length === 0 && (
                    <p className="no-subjects">ยังไม่มีวิชาในหมวดนี้</p>
                  )}
                  {autoScheduleSubjects.map((subject) => (
                    <div className="subject-list-entry" key={subject.key}>
                      <div
                        className={`subject-control subject-control-${subject.kind}`}
                      >
                        <label
                          htmlFor={subject.kind === "subject" ? `weight-${subject.key}` : undefined}
                          className="subject-name"
                        >
                          <span
                            className="subject-mark"
                            style={
                              {
                                "--subject-color": subject.color,
                              } as CSSProperties
                            }
                          />
                          <span className="subject-label-group">
                            <span className="subject-label">
                              {subject.label}
                            </span>
                          </span>
                        </label>
                        <span className={`item-kind item-kind-${subject.kind}`}>
                          {subject.kind === "activity" ? "กิจกรรม" : "วิชา"}
                        </span>
                        {subject.kind === "subject" && (
                          <select
                            id={`weight-${subject.key}`}
                            className="weight-select"
                            value={subject.weight}
                            onChange={(event) =>
                              changeWeight(
                                subject.key,
                                Number(event.target.value) as PriorityWeight,
                              )
                            }
                            aria-label={`ระดับความสำคัญวิชา${subject.label}`}
                          >
                            {PRIORITY_WEIGHT_LEVELS.map((weight) => (
                              <option key={weight} value={weight}>
                                {weight}%
                              </option>
                            ))}
                          </select>
                        )}
                        {subject.kind === "subject" && (
                          <output className="weight-value">
                            {weightPercentByKey.get(subject.key) ?? 0}% ของ GA
                          </output>
                        )}
                        <button
                          className="remove-subject"
                          type="button"
                          aria-label={`นำ${subject.kind === "activity" ? "กิจกรรม" : "วิชา"}${subject.label}ออก`}
                          onClick={() =>
                            updateSubject({ subjectKey: subject.key }, "DELETE")
                          }
                        >
                          นำออก
                        </button>
                        {subject.kind === "subject" && (
                          <div className="subject-color-field subject-color-field-inline">
                            <span>สีประจำวิชา</span>
                            <SubjectColorPicker
                              color={subject.color}
                              label={`สีของวิชา${subject.label}`}
                              disabled={savingColorKey !== null}
                              onChange={(color) =>
                                void changeSubjectColor(subject.key, color)
                              }
                            />
                            {savingColorKey === subject.key && (
                              <small className="color-saving-label">
                                กำลังบันทึกสี...
                              </small>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </fieldset>

                <div className="schedule-settings">
                  <label htmlFor="days-per-week">วันอ่านต่อสัปดาห์</label>
                  <select
                    id="days-per-week"
                    value={daysPerWeek}
                    onChange={(event) => {
                      clearAlgorithmComparison();
                      setDaysPerWeek(Number(event.target.value));
                    }}
                  >
                    {Array.from({ length: 7 }, (_, index) => index + 1).map(
                      (days) => (
                        <option key={days} value={days}>
                          {days} วัน
                        </option>
                      ),
                    )}
                  </select>

                  <label htmlFor="start-time">เริ่มอ่าน</label>
                  <input
                    id="start-time"
                    type="time"
                    min="06:00"
                    max="21:00"
                    step="3600"
                    value={startTime}
                    onChange={(event) => {
                      clearAlgorithmComparison();
                      setStartTime(event.target.value);
                    }}
                  />

                  <label htmlFor="end-time">สิ้นสุด</label>
                  <input
                    id="end-time"
                    type="time"
                    min="06:00"
                    max="23:00"
                    step="3600"
                    value={endTime}
                    onChange={(event) => {
                      clearAlgorithmComparison();
                      setEndTime(event.target.value);
                    }}
                  />
                  <span className="schedule-settings-note">
                    อ่าน 2 ชั่วโมง พัก 25 นาที
                  </span>
                </div>

                <form onSubmit={generateSchedule}>
                  <button
                    className="generate-button"
                    type="submit"
                    disabled={
                      isGenerating ||
                      isLoading ||
                      autoScheduleSubjects.length === 0 ||
                      categoryId === null
                    }
                  >
                    {isGenerating ? "กำลังจัดตาราง..." : "สร้างตารางอัตโนมัติ"}
                  </button>
                </form>
                <div className="algorithm-comparison-actions">
                  <button
                    className="compare-algorithms-button"
                    type="button"
                    onClick={() => void compareAlgorithms()}
                    disabled={
                      isComparingAlgorithms ||
                      isGenerating ||
                      isLoading ||
                      autoScheduleSubjects.length === 0 ||
                      categoryId === null
                    }
                  >
                    {isComparingAlgorithms
                      ? "กำลังเปรียบเทียบ..."
                      : "เปรียบเทียบ 5 Algorithms"}
                  </button>
                  <p>
                    ทดลอง GA และ Random 5 รอบ พร้อม Greedy และ Rule-based โดยไม่เปลี่ยนตารางจริง
                  </p>
                  <button
                    className="sample-benchmark-button"
                    type="button"
                    onClick={() => void runSampleBenchmarks()}
                    disabled={isRunningSampleBenchmark || isLoading}
                  >
                    {isRunningSampleBenchmark
                      ? "กำลังทดสอบข้อมูลตัวอย่าง 5 กรณี..."
                      : "ทดสอบข้อมูลตัวอย่าง 5 กรณี"}
                  </button>
                  <p>
                    ใช้ข้อมูลจำลองที่กำหนดไว้ในโค้ด และแสดง Fitness Score กับ Penalty ของทุก Algorithm
                  </p>
                </div>
              </div>
            </>
          )}
        </aside>

        <section className="schedule-panel" aria-labelledby="schedule-title">
          <div className="section-heading schedule-title-row">
            <div>
              <h2 id="schedule-title">แผนประจำสัปดาห์</h2>
            </div>
            {schedule && (
              <p className="total-time">
                อ่านแล้ว {completedHours}/{totalSessions} ชม. ·{" "}
                {completionPercent}%
              </p>
            )}
          </div>

          <div className="schedule-toolbar">
            <div className="week-navigation" aria-label="เลือกช่วงเวลา">
              <button
                type="button"
                aria-label={scheduleView === "monthly" ? "เดือนก่อน" : "สัปดาห์ก่อน"}
                onClick={() => {
                  if (scheduleView === "monthly") {
                    setSelectedCalendarDate(null);
                    setMonthOffset((offset) => offset - 1);
                    return;
                  }

                  setSelectedCalendarDate(null);
                  const nextOffset = weekOffset - 1;
                  setWeekOffset(nextOffset);
                  if (categoryId !== null) {
                    void loadCategory(categoryId, getWeekStartDate(nextOffset));
                  }
                }}
              >
                ‹
              </button>
              <button
                type="button"
                className="week-current-button"
                onClick={() => {
                  if (scheduleView === "monthly") {
                    setSelectedCalendarDate(null);
                    setMonthOffset(0);
                    return;
                  }

                  setSelectedCalendarDate(null);
                  setWeekOffset(0);
                  if (categoryId !== null) {
                    void loadCategory(categoryId, getWeekStartDate(0));
                  }
                }}
              >
                {scheduleView === "monthly" ? "เดือนนี้" : "สัปดาห์นี้"}
              </button>
              <span>
                {scheduleView === "monthly" ? monthLabel : weekRangeLabel}
              </span>
              <button
                type="button"
                aria-label={scheduleView === "monthly" ? "เดือนถัดไป" : "สัปดาห์ถัดไป"}
                onClick={() => {
                  if (scheduleView === "monthly") {
                    setSelectedCalendarDate(null);
                    setMonthOffset((offset) => offset + 1);
                    return;
                  }

                  setSelectedCalendarDate(null);
                  const nextOffset = weekOffset + 1;
                  setWeekOffset(nextOffset);
                  if (categoryId !== null) {
                    void loadCategory(categoryId, getWeekStartDate(nextOffset));
                  }
                }}
              >
                ›
              </button>
            </div>
            <div
              className="schedule-view-tabs"
              role="tablist"
              aria-label="มุมมองตาราง"
            >
              {(
                [
                  ["daily", "วัน"],
                  ["weekly", "สัปดาห์"],
                  ["monthly", "เดือน"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={scheduleView === value}
                  className={scheduleView === value ? "active" : ""}
                  onClick={() => {
                    if (value !== "daily") setSelectedCalendarDate(null);
                    setManualEntryStartTime(null);
                    setScheduleView(value);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {((schedule && (scheduleView !== "weekly" || schedule.sessions.length > 0)) || scheduleView === "monthly" || scheduleView === "daily") ? (
            <>
              {scheduleView === "daily" && (
                <div className="schedule-list-view">
                  {selectedCalendarDate && (
                    <p className="schedule-day-selected-date">
                      ตารางวันที่ {new Intl.DateTimeFormat("th-TH", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                        timeZone: "UTC",
                      }).format(new Date(selectedCalendarDate + "T00:00:00Z"))}
                    </p>
                  )}
                  <div
                    className="schedule-day-tabs"
                    role="tablist"
                    aria-label="เลือกวัน"
                  >
                    {Array.from(
                      { length: 7 },
                      (_, dayIndex) => (
                        <button
                          key={dayIndex}
                          type="button"
                          className={selectedDayIndex === dayIndex ? "active" : ""}
                          onClick={() => {
                            setSelectedDayIndex(dayIndex);
                            if (selectedCalendarDate) {
                              const date = new Date(selectedCalendarDate + "T00:00:00Z");
                              date.setUTCDate(date.getUTCDate() + dayIndex - ((date.getUTCDay() + 6) % 7));
                              setSelectedCalendarDate(formatLocalDate(new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())));
                            }
                          }}
                        >
                          {dayNames[dayIndex]}
                        </button>
                      ),
                    )}
                  </div>
                  <div className="schedule-list">
                    {Array.from(
                      {
                        length: schedule?.sessionsPerDay ?? studyTimeline.sessions.length,
                      },
                      (_, sessionIndex) => {
                        const session = schedule?.sessions.find(
                          (item) =>
                            item.dayIndex === selectedDayIndex &&
                            item.sessionIndex === sessionIndex,
                        );
                        const subject = subjects.find(
                          (item) => item.key === session?.subjectKey,
                        );
                        const slot = studyTimeline.sessions[sessionIndex];
                        const slotStart = slot?.startTime ?? effectiveStartTime;
                        const slotEnd = slot?.endTime ?? effectiveEndTime;
                        const toMinutes = (value: string) => {
                          const [hours, minutes] = value.split(":").map(Number);
                          return hours * 60 + minutes;
                        };
                        const manualBlock = manualStudyBlocks.find((block) => {
                          const belongsToSelectedDay = selectedCalendarDate
                            ? block.scheduledDate === selectedCalendarDate ||
                              (!block.scheduledDate && block.dayIndex === selectedDayIndex)
                            : !block.scheduledDate && block.dayIndex === selectedDayIndex;
                          if (!belongsToSelectedDay) return false;
                          const blockStart = toMinutes(block.startTime);
                          const blockEnd = blockStart + block.durationMinutes;
                          return toMinutes(slotStart) < blockEnd && blockStart < toMinutes(slotEnd);
                        });
                        const sessionTime = getSessionTimeRange(
                          effectiveStartTime,
                          effectiveEndTime,
                          sessionIndex,
                        );
                        // Hide empty time slots so they are not mistaken for generated study sessions.
                        if (!session && !manualBlock) return null;
                        return (
                          <div key={sessionIndex}>
                            {pauseAfterSession.has(sessionIndex - 1) && (
                              <div className="schedule-break-row">
                                {pauseAfterSession.get(sessionIndex - 1)}
                              </div>
                            )}
                            <div
                              className={`schedule-list-item ${session?.isCompleted ? "session-completed" : ""}`}
                            >
                              <span className="schedule-list-time">{sessionTime}</span>
                              {(subject || manualBlock) && (
                                <strong>{subject?.label ?? manualBlock?.subjectLabel}</strong>
                              )}
                              {(session || manualBlock) && (
                                <span className="schedule-list-status">
                                  {session?.isCompleted
                                    ? "อ่านแล้ว"
                                    : session
                                      ? "ยังไม่ทำ"
                                      : "เพิ่มเอง"}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      },
                    )}
                  </div>
                </div>
              )}

              {scheduleView === "weekly" && schedule && schedule.sessions.length > 0 && (
                <div
                  className="week-grid-scroll"
                  role="region"
                  aria-label="แผนประจำสัปดาห์ เลื่อนเพื่อดูตาราง"
                  tabIndex={0}
                >
                  <div
                    className="week-grid"
                    style={{ "--day-count": 7 } as CSSProperties}
                  >
                    {Array.from({ length: 7 }, (_, dayIndex) => (
                      <section
                        className="day-column"
                        key={dayIndex}
                        aria-label={`วัน${dayNames[dayIndex]}`}
                      >
                        <h3>
                          {dayNames[dayIndex]}{" "}
                          <time>
                            {new Intl.DateTimeFormat("th-TH", {
                              day: "numeric",
                            }).format(
                              new Date(
                                visibleWeekStart.getFullYear(),
                                visibleWeekStart.getMonth(),
                                visibleWeekStart.getDate() + dayIndex,
                              ),
                            )}
                          </time>
                        </h3>
                        <div className="day-sessions">
                          {Array.from(
                            {
                              length:
                                dayIndex < (schedule?.daysPerWeek ?? daysPerWeek)
                                  ? Math.min(
                                      schedule?.sessionsPerDay ?? studyTimeline.sessions.length,
                                      studyTimeline.sessions.length,
                                    )
                                  : 0,
                            },
                            (_, sessionIndex) => {
                              const session = schedule?.sessions.find(
                                (item) =>
                                  item.dayIndex === dayIndex &&
                                  item.sessionIndex === sessionIndex,
                              );
                              const subject = subjects.find(
                                (item) => item.key === session?.subjectKey,
                              );
                              const sessionTime = getSessionTimeRange(
                                schedule?.startTime ?? effectiveStartTime,
                                schedule?.endTime ?? effectiveEndTime,
                                sessionIndex,
                              );
                              return (
                                <div key={`session-${sessionIndex}`}>
                                  {pauseAfterSession.has(sessionIndex - 1) && (
                                    <div className="lunch-break">
                                      {pauseAfterSession.get(sessionIndex - 1)}
                                    </div>
                                  )}
                                  <div
                                    className={`session-block ${session?.isCompleted ? "session-completed" : ""}`}
                                    key={`block-${sessionIndex}`}
                                    style={
                                      {
                                        "--subject-color":
                                          subject?.color ?? "#d8dedb",
                                      } as CSSProperties
                                    }
                                  >
                                    <span className="session-number">
                                      {sessionTime}
                                    </span>
                                    <div className="session-subject-row">
                                      <select
                                        className="session-subject-select"
                                        value={session?.subjectKey ?? ""}
                                        disabled={!session}
                                        aria-label={`ปรับวิชา ${dayNames[dayIndex]} ช่วง ${getSessionTimeRange(
                                          schedule?.startTime ?? effectiveStartTime,
                                          schedule?.endTime ?? effectiveEndTime,
                                          sessionIndex,
                                        )}`}
                                        onChange={(event) => {
                                          if (session)
                                            void customizeSessionSubject(
                                              session,
                                              event.target.value,
                                            );
                                        }}
                                      >
                                        {subjects.map((item) => (
                                          <option
                                            key={item.key}
                                            value={item.key}
                                          >
                                            {item.label}
                                          </option>
                                        ))}
                                      </select>
                                      {session && subject && (
                                        <div className="session-note-actions">
                                          <button
                                            className="session-note-button"
                                            type="button"
                                            onClick={() =>
                                              openSessionNote(session, "lecture")
                                            }
                                          >
                                            Lecture
                                          </button>
                                          {session.lectureNotes.trim() && (
                                            <button
                                              className="session-note-button has-note session-note-icon-button"
                                              type="button"
                                              onClick={() =>
                                                setLecturePreview({
                                                  title: subject.label,
                                                  subtitle: `${dayNames[dayIndex]} · ${sessionTime}`,
                                                  content: session.lectureNotes,
                                                })
                                              }
                                              aria-label={`ดู Lecture ที่บันทึกไว้: ${subject.label}`}
                                              title="ดู Lecture ที่บันทึกไว้"
                                            >
                                              <svg
                                                aria-hidden="true"
                                                viewBox="0 0 24 24"
                                                width="16"
                                                height="16"
                                                fill="none"
                                                stroke="currentColor"
                                                strokeWidth="1.8"
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                              >
                                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                                <path d="M14 2v6h6" />
                                                <path d="M8 13h8" />
                                                <path d="M8 17h8" />
                                              </svg>
                                            </button>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                    <label className="session-completion">
                                      <input
                                        type="checkbox"
                                        checked={session?.isCompleted ?? false}
                                        disabled={!session}
                                        onChange={(event) => {
                                          if (session)
                                            void updateSessionCompletion(
                                              session,
                                              event.target.checked,
                                            );
                                        }}
                                        aria-label={`อ่าน${subject?.label ?? "ช่วงนี้"}เสร็จแล้ว`}
                                      />
                                      <span>อ่านแล้ว</span>
                                    </label>
                                  </div>
                                </div>
                              );
                            },
                          )}
                          {dayIndex >= (schedule?.daysPerWeek ?? daysPerWeek) && (
                            <p className="schedule-rest-day">วันพัก</p>
                          )}

                        </div>
                      </section>
                    ))}
                  </div>
                </div>
              )}

              {scheduleView === "monthly" && (
                <div
                  className="month-calendar"
                  aria-label={"ปฏิทินเดือน " + monthLabel}
                >
                  <div className="month-category-legend">
                    <span className="month-category-legend-item">
                      <span
                        className="month-schedule-dot"
                        style={{ "--category-plan-color": getCategoryPlanColor(categoryId) } as CSSProperties}
                        aria-hidden="true"
                      />
                      <span>{categories.find((category) => category.id === categoryId)?.name ?? "หมวดที่เลือก"}</span>
                    </span>
                    {visibleOtherCategoryMonthlyPlans.map((plan) => (
                      <span className="month-category-legend-item" key={plan.categoryId}>
                        <span
                          className="month-schedule-dot"
                          style={{ "--category-plan-color": getCategoryPlanColor(plan.categoryId) } as CSSProperties}
                          aria-hidden="true"
                        />
                        <span>{plan.categoryName}</span>
                      </span>
                    ))}
                  </div>
                  <div className="month-weekday-row">
                    {dayNames.map((dayName) => (
                      <div key={dayName} className="month-weekday">
                        {dayName}
                      </div>
                    ))}
                  </div>

                  <div className="month-grid">
                    {calendarDateKeys.map((dateKey) => {
                      const [year, month, day] = dateKey.split("-").map(Number);
                      const cellDate = new Date(year, month - 1, day);
                      const isCurrentMonth =
                        cellDate.getMonth() === visibleMonth.getMonth() &&
                        cellDate.getFullYear() === visibleMonth.getFullYear();
                      const todayKey = formatLocalDate(new Date());
                      const isToday = dateKey === todayKey;
                      const dayIndex = (cellDate.getDay() + 6) % 7;

                      const monday = new Date(cellDate);
                      monday.setDate(
                        cellDate.getDate() -
                          ((cellDate.getDay() + 6) % 7),
                      );
                      const weekStartKey = formatLocalDate(monday);
                      const cellSchedule = monthSchedules[weekStartKey];
                      const cellSessions = cellSchedule
                        ? cellSchedule.sessions
                            .filter((session) => session.dayIndex === dayIndex)
                            .sort(
                              (a, b) => a.sessionIndex - b.sessionIndex,
                            )
                        : [];
                      const cellManualBlocks = manualStudyBlocks.filter(
                        (block) =>
                          block.scheduledDate === dateKey ||
                          (!block.scheduledDate && block.dayIndex === dayIndex),
                      );
                      const dayEntryCount = cellSessions.length + cellManualBlocks.length;
                      const otherCategoryMarksForDay = visibleOtherCategoryMonthlyMarks.filter(
                        (mark) => mark.dateKey === dateKey,
                      );

                      return (
                        <article
                          className={
                            "month-day month-day-clickable" +
                            (!isCurrentMonth ? " outside-month" : "") +
                            (isToday ? " today" : "") +
                            (selectedCalendarDate === dateKey ? " selected-date" : "")
                          }
                          key={dateKey}
                          role="button"
                          tabIndex={0}
                          aria-label={
                            "เปิดตารางวันที่ " +
                            dateKey +
                            (dayEntryCount > 0
                              ? " มี " + dayEntryCount + " ช่วงที่จัดไว้"
                              : " ยังไม่มีตาราง")
                          }
                          onClick={() => {
                            const nextWeekOffset = getWeekOffsetForDate(cellDate);
                            setWeekOffset(nextWeekOffset);
                            setSelectedCalendarDate(dateKey);
                            setSelectedDayIndex(dayIndex);
                            setScheduleView("daily");

                            if (categoryId !== null) {
                              // Reload the selected week's own subjects and saved schedule from MySQL.
                              void loadCategory(categoryId, weekStartKey);
                            }
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              const nextWeekOffset = getWeekOffsetForDate(cellDate);
                              setWeekOffset(nextWeekOffset);
                              setSelectedCalendarDate(dateKey);
                              setSelectedDayIndex(dayIndex);
                              setScheduleView("daily");

                              if (categoryId !== null) {
                                // Reload this week's own saved subjects/settings from MySQL.
                                void loadCategory(categoryId, weekStartKey);
                              }
                            }
                          }}
                        >
                          <div className="month-day-header">
                            <time dateTime={dateKey}>{day}</time>
                          </div>

                          {(dayEntryCount > 0 || otherCategoryMarksForDay.length > 0) && (
                            <div className="month-schedule-dots" aria-label={"หมวดที่มีตารางวันที่ " + dateKey}>
                              {dayEntryCount > 0 && (
                                <span
                                  className="month-schedule-dot"
                                  style={{ "--category-plan-color": getCategoryPlanColor(categoryId) } as CSSProperties}
                                  aria-label={dayEntryCount + " ช่วงที่จัดไว้ในหมวด " + (categories.find((category) => category.id === categoryId)?.name ?? "ที่เลือก")}
                                  title={dayEntryCount + " ช่วงที่จัดไว้ในหมวด " + (categories.find((category) => category.id === categoryId)?.name ?? "ที่เลือก")}
                                />
                              )}
                              {otherCategoryMarksForDay.map((mark) => (
                                <span
                                  className="month-schedule-dot"
                                  key={mark.categoryId}
                                  style={{ "--category-plan-color": getCategoryPlanColor(mark.categoryId) } as CSSProperties}
                                  aria-label={"มีตารางในหมวด " + mark.categoryName}
                                  title={"มีตารางในหมวด " + mark.categoryName}
                                />
                              ))}
                            </div>
                          )}
                        </article>
                      );
                    })}
                  </div>
                </div>
              )}

              {schedule && (
                <div className="allocation">
                  <h3>สัดส่วนเป้าหมาย (รวม 100%)</h3>
                <div className="allocation-list">
                  {scheduledCounts.map((subject) => (
                    <div className="allocation-row" key={subject.key}>
                      <span className="allocation-name">
                        <span
                          className="subject-mark"
                          style={
                            {
                              "--subject-color": subject.color,
                            } as CSSProperties
                          }
                        />
                        {subject.label}
                      </span>
                      <div
                        className="allocation-track"
                        aria-label={`${subject.label} ${subject.count} ชั่วโมง`}
                      >
                        <span
                          className="allocation-fill"
                          style={
                            {
                              "--subject-color": subject.color,
                              width: `${totalTargetSessions ? (subject.count / totalTargetSessions) * 100 : 0}%`,
                            } as CSSProperties
                          }
                        />
                      </div>
                      <span className="allocation-count">
                        อ่าน {subject.completedCount}/{subject.count} ชม.
                      </span>
                      <span className="allocation-share">
                        เป้า {subject.targetPercent}% ·{" "}
                        {subject.count > 0
                          ? Math.round(
                              (subject.completedCount / subject.count) * 100,
                            )
                          : 0}
                        % เสร็จ
                      </span>
                    </div>
                  ))}
                </div>
                </div>
              )}
            </>
          ) : (
            <div className="empty-state">
              <p>ยังไม่มีตารางอ่าน</p>
              <span>
                {subjects.length > 0
                  ? "กำหนดน้ำหนักแต่ละรายการ แล้วสร้างตารางเพื่อเริ่มต้น"
                  : "เพิ่มรายการเพื่อเริ่มจัดตาราง"}
              </span>
            </div>
          )}
          {activities.length > 0 && (
            <div className="activity-schedule">
              <div className="activity-schedule-header">
                <div>
                  <strong>กิจกรรมตามกำหนด</strong>
                  <span>วันที่และเวลาจาก “เพิ่มตารางใหม่”</span>
                </div>
                <span>{activities.length} รายการ</span>
              </div>
              <div className="activity-schedule-list">
                {activities.map((activity) => {
                  const course = subjects.find(
                    (subject) => subject.key === activity.courseKey,
                  );
                  const dateText =
                    activity.startDate || activity.endDate
                      ? `${activity.startDate ?? "-"} ถึง ${activity.endDate ?? "-"}`
                      : "ยังไม่กำหนดวันที่";
                  const timeText =
                    activity.startTime || activity.endTime
                      ? `${activity.startTime ?? "-"}–${activity.endTime ?? "-"} น.`
                      : "ยังไม่กำหนดเวลา";
                  return (
                    <div className="activity-schedule-row" key={activity.id}>
                      <div className="activity-schedule-main">
                        <strong>{activity.title}</strong>
                        <span>
                          {course ? `วิชา ${course.label}` : "ไม่ผูกวิชา"} ·{" "}
                          {activity.durationHours} ชม.
                        </span>
                        {activity.details && <small>{activity.details}</small>}
                      </div>
                      <div className="activity-schedule-when">
                        <span>{dateText}</span>
                        <span>{timeText}</span>
                        <button
                          className={"activity-completion-button " + (activity.isCompleted ? "is-completed" : "is-pending")}
                          type="button"
                          aria-pressed={activity.isCompleted}
                          aria-label={activity.isCompleted
                            ? "เปลี่ยนสถานะกิจกรรม " + activity.title + " เป็นยังไม่เสร็จ"
                            : "ทำเครื่องหมายกิจกรรม " + activity.title + " ว่าทำเสร็จแล้ว"}
                          disabled={savingActivityStatusId === String(activity.id)}
                          onClick={() => void toggleActivityCompletion(activity)}
                        >
                          {savingActivityStatusId === String(activity.id)
                            ? "กำลังบันทึก…"
                            : activity.isCompleted
                              ? "✓ ทำเสร็จแล้ว"
                              : "○ ยังไม่เสร็จ"}
                        </button>
                        <button
                          className="activity-delete-button"
                          type="button"
                          disabled={deletingActivityId === String(activity.id)}
                          onClick={() => void deleteActivity(activity)}
                        >
                          {deletingActivityId === String(activity.id)
                            ? "กำลังลบ…"
                            : "ลบกิจกรรม"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {categoryId !== null && (
            <ManualScheduleEditor
              key={categoryId}
              categoryId={categoryId}
              subjects={subjects}
              isAddModalOpen={isManualScheduleModalOpen}
              selectedDate={selectedCalendarDate}
              subjectScopeDate={getCurrentSubjectScopeDate()}
              preferredStartTime={manualEntryStartTime}
              onCloseAddModal={() => {
                setIsManualScheduleModalOpen(false);
                setManualEntryStartTime(null);
              }}
              onBlocksUpdated={handleManualBlocksUpdated}
              onSubjectsUpdated={(updatedSubjects, updatedAvailableSubjects) => {
                clearAlgorithmComparison();
                setSubjects(updatedSubjects);
                setAvailableSubjects(updatedAvailableSubjects);
                const updatedWeights = new Map(
                  [...updatedSubjects, ...updatedAvailableSubjects].map(
                    (subject) => [subject.key, subject.weight],
                  ),
                );
                setActivities((current) =>
                  current.map((activity) => {
                    const subjectWeight = activity.subjectKey
                      ? updatedWeights.get(activity.subjectKey)
                      : undefined;
                    return subjectWeight === undefined
                      ? activity
                      : { ...activity, weight: subjectWeight };
                  }),
                );
              }}
            />
          )}
        </section>
      </div>

      {algorithmComparisonError && (
        <p className="algorithm-comparison-error" role="alert">
          {algorithmComparisonError}
        </p>
      )}

      {algorithmComparison && (
        <section
          className="algorithm-comparison-panel"
          aria-labelledby="algorithm-comparison-title"
        >
          <div className="section-heading algorithm-comparison-heading">
            <div>
              <h2 id="algorithm-comparison-title">ผลเปรียบเทียบ Algorithms</h2>
              <p>
                ใช้รายวิชา Weight และจำนวนช่วงอ่านชุดเดียวกันทั้งหมด Fitness Score ยิ่งสูงยิ่งดี และ Penalty ยิ่งต่ำยิ่งดี
              </p>
            </div>
            <button
              type="button"
              className="algorithm-comparison-close"
              onClick={() => setAlgorithmComparison(null)}
            >
              ซ่อนผล
            </button>
          </div>

          <div className="algorithm-comparison-table-wrap">
            <table className="algorithm-comparison-table">
              <thead>
                <tr>
                  <th>Algorithm</th>
                  <th>จำนวนรอบ</th>
                  <th>Fitness เฉลี่ย ↑</th>
                  <th>Fitness ดีที่สุด ↑</th>
                  <th>Penalty เฉลี่ย ↓</th>
                  <th>Penalty ดีที่สุด</th>
                  <th>SD</th>
                  <th>เวลาเฉลี่ย (ms)</th>
                  <th>คลาดเคลื่อนจาก Weight (ช่วง)</th>
                  <th>วิชาซ้ำติดกัน</th>
                  <th>ซ้ำเวลาเดิมวันถัดไป</th>
                </tr>
              </thead>
              <tbody>
                {algorithmComparison.results.map((result) => {
                  const isLowestPenalty =
                    result.meanPenalty === algorithmComparison.results[0]?.meanPenalty;
                  return (
                    <tr
                      key={result.algorithm}
                      className={isLowestPenalty ? "algorithm-comparison-best" : ""}
                    >
                      <th scope="row">
                        {result.algorithm}
                        {isLowestPenalty && (
                          <span className="algorithm-best-label">คะแนนเฉลี่ยต่ำสุด</span>
                        )}
                      </th>
                      <td>{result.runs}</td>
                      <td>{result.meanFitnessScore.toFixed(2)}</td>
                      <td>{result.bestFitnessScore.toFixed(2)}</td>
                      <td>{result.meanPenalty.toFixed(3)}</td>
                      <td>{result.bestPenalty.toFixed(3)}</td>
                      <td>{result.penaltyStandardDeviation.toFixed(3)}</td>
                      <td>{result.meanRuntimeMs.toFixed(2)}</td>
                      <td>{result.meanTargetDeviation.toFixed(2)}</td>
                      <td>{result.meanAdjacentRepeats.toFixed(2)}</td>
                      <td>{result.meanSameTimeRepeats.toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="algorithm-comparison-note">
            GA ทั้งสองเวอร์ชันและ Random รันทดลอง {algorithmComparison.runsPerStochasticMethod} รอบด้วย seed ต่างกัน
            ส่วน Greedy และ Rule-based เป็นวิธีแบบกำหนดกฎ จึงทดลองหนึ่งครั้งต่อการเปรียบเทียบ
            ค่า SD ที่ใกล้ 0 หมายถึงผลแต่ละรอบมีความแปรปรวนน้อย
          </p>

          <h3 className="algorithm-target-title">
            จำนวนช่วงเรียนเป้าหมายตาม Weight ({algorithmComparison.sessionCount} ช่วง)
          </h3>
          <div className="algorithm-target-list">
            {algorithmComparison.targetAllocation.map((target) => (
              <div className="algorithm-target-item" key={target.key}>
                <span>{target.label}</span>
                <strong>{target.weight}% · {target.targetSessions} ช่วง</strong>
              </div>
            ))}
          </div>
        </section>
      )}

      {sampleBenchmarkError && (
        <p className="algorithm-comparison-error" role="alert">
          {sampleBenchmarkError}
        </p>
      )}

      {sampleBenchmark && (
        <section
          className="algorithm-sample-panel"
          aria-labelledby="algorithm-sample-title"
        >
          <div className="section-heading algorithm-comparison-heading">
            <div>
              <h2 id="algorithm-sample-title">ผลทดสอบข้อมูลตัวอย่าง 5 กรณี</h2>
              <p>
                ทุกวิธีใช้ Weight และจำนวนช่วงอ่านชุดเดียวกันในแต่ละกรณี เปรียบเทียบ Fitness Score และ Penalty
              </p>
            </div>
            <button
              type="button"
              className="algorithm-comparison-close"
              onClick={() => setSampleBenchmark(null)}
            >
              ซ่อนผลทดสอบ
            </button>
          </div>

          <div className="algorithm-fitness-rule">
            <strong>Fitness Score = 100 ÷ (1 + Penalty ÷ จำนวนช่วงอ่าน)</strong>
            <span>Fitness Score ยิ่งสูงยิ่งดี (สูงสุด 100) · Penalty ยิ่งต่ำยิ่งดี</span>
          </div>

          <h3 className="algorithm-target-title">ค่าตั้งต้น GA ปรับปรุง</h3>
          <div className="algorithm-sample-subjects algorithm-ga-settings">
            <span>Population Size <strong>{sampleBenchmark.improvedGaSettings.populationSize}</strong></span>
            <span>Generations <strong>{sampleBenchmark.improvedGaSettings.generations}</strong></span>
            <span>Mutation Rate <strong>{(sampleBenchmark.improvedGaSettings.mutationRate * 100).toFixed(0)}%</strong></span>
            <span>Local Search <strong>{sampleBenchmark.improvedGaSettings.localSearchIterations} ครั้ง/ลูก</strong></span>
            <span>Crossover <strong>Day Uniform + Repair</strong></span>
            <span>Mutation Operator <strong>Move / Swap</strong></span>
          </div>

          <h3 className="algorithm-target-title">สรุปภาพรวมทั้ง 5 กรณี</h3>
          <div className="algorithm-comparison-table-wrap">
            <table className="algorithm-sample-table">
              <thead>
                <tr>
                  <th>Algorithm</th>
                  <th>Fitness Score เฉลี่ย ↑</th>
                  <th>Penalty ต่อช่วงเฉลี่ย ↓</th>
                  <th>กรณีที่ได้คะแนน Penalty ดีที่สุด</th>
                </tr>
              </thead>
              <tbody>
                {sampleBenchmark.overall.map((item, index) => {
                  const isTop =
                    item.averageFitnessScore === sampleBenchmark.overall[0]?.averageFitnessScore;
                  return (
                    <tr
                      key={item.algorithm}
                      className={isTop ? "algorithm-comparison-best" : ""}
                    >
                      <th scope="row">
                        {index + 1}. {item.algorithm}
                        {isTop && <span className="algorithm-best-label">Fitness เฉลี่ยสูงสุด</span>}
                      </th>
                      <td>{item.averageFitnessScore.toFixed(2)}</td>
                      <td>{item.averageNormalizedPenalty.toFixed(4)}</td>
                      <td>{item.bestCaseWins} / {sampleBenchmark.cases.length} กรณี</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="algorithm-comparison-note">
            GA ทั้งสองเวอร์ชันและ Random ทดลอง {sampleBenchmark.runsPerStochasticMethod} รอบต่อกรณีด้วย seed ที่กำหนดไว้ในโค้ด
            ส่วน Greedy และ Rule-based ทดลอง 1 ครั้งต่อกรณี ค่าเวลาอาจต่างกันตามเครื่องที่รัน
          </p>

          <h3 className="algorithm-target-title">คะแนนแยกตามชุดข้อมูล</h3>
          <div className="algorithm-sample-cases">
            {sampleBenchmark.cases.map((sampleCase) => {
              const lowestPenalty = Math.min(
                ...sampleCase.results.map((result) => result.meanPenalty),
              );
              return (
                <article className="algorithm-sample-case" key={sampleCase.id}>
                  <div className="algorithm-sample-case-heading">
                    <div>
                      <h4>{sampleCase.name}</h4>
                      <p>{sampleCase.description}</p>
                    </div>
                    <span>{sampleCase.daysPerWeek} วัน × {sampleCase.sessionsPerDay} ช่วง = {sampleCase.sessionCount} ช่วง</span>
                  </div>

                  <div className="algorithm-sample-subjects">
                    {sampleCase.subjects.map((subject) => (
                      <span key={subject.label}>
                        {subject.label} <strong>{subject.weight}%</strong>
                      </span>
                    ))}
                  </div>

                  <p className="algorithm-sample-winner">
                    Penalty เฉลี่ยต่ำสุด: <strong>{sampleCase.winnerAlgorithms.join(" / ")}</strong>
                  </p>

                  <div className="algorithm-comparison-table-wrap">
                    <table className="algorithm-sample-table">
                      <thead>
                        <tr>
                          <th>Algorithm</th>
                          <th>Fitness เฉลี่ย ↑</th>
                          <th>Fitness ดีที่สุด</th>
                          <th>Penalty เฉลี่ย ↓</th>
                          <th>Penalty ดีที่สุด</th>
                          <th>เวลาเฉลี่ย (ms)</th>
                          <th>คลาด Weight</th>
                          <th>ซ้ำติดกัน</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sampleCase.results.map((result) => {
                          const isBest =
                            Math.abs(result.meanPenalty - lowestPenalty) < 0.0005;
                          return (
                            <tr
                              key={result.algorithm}
                              className={isBest ? "algorithm-comparison-best" : ""}
                            >
                              <th scope="row">
                                {result.algorithm}
                                {isBest && <span className="algorithm-best-label">ดีที่สุดในกรณีนี้</span>}
                              </th>
                              <td>{result.meanFitnessScore.toFixed(2)}</td>
                              <td>{result.bestFitnessScore.toFixed(2)}</td>
                              <td>{result.meanPenalty.toFixed(3)}</td>
                              <td>{result.bestPenalty.toFixed(3)}</td>
                              <td>{result.meanRuntimeMs.toFixed(2)}</td>
                              <td>{result.meanTargetDeviation.toFixed(2)}</td>
                              <td>{result.meanAdjacentRepeats.toFixed(2)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {lecturePreview && (
        <div
          className="mock-note-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget)
              setLecturePreview(null);
          }}
        >
          <section
            className="mock-note-modal home-lecture-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="study-plan-lecture-title"
          >
            <div className="note-header">
              <h3 id="study-plan-lecture-title">Lecture</h3>
              <button
                type="button"
                className="close-note"
                onClick={() => setLecturePreview(null)}
                aria-label="ปิด"
              >
                ×
              </button>
            </div>
            <p className="session-course">
              {lecturePreview.title} · {lecturePreview.subtitle}
            </p>
            <div className="home-lecture-content">
              {lecturePreview.content}
            </div>
            <div className="note-actions">
              <button
                type="button"
                className="secondary-btn"
                onClick={() => setLecturePreview(null)}
              >
                ปิด
              </button>
            </div>
          </section>
        </div>
      )}

      {noteSession && noteSubject && (
        <div
          className="session-note-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget)
              setOpenSessionNoteId(null);
          }}
        >
          <section
            className="session-note-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="session-note-title"
          >
            <div className="session-note-modal-header">
              <div>
                <h2 id="session-note-title">
                  {subjectNoteType === "future" ? "Future Note" : "Lecture"}
                </h2>
                <p>
                  {noteSubject.label} · {dayNames[noteSession.dayIndex]}
                </p>
              </div>
              <button
                type="button"
                className="activity-modal-close"
                onClick={() => setOpenSessionNoteId(null)}
                aria-label="ปิด"
              >
                ×
              </button>
            </div>

            <label className="sr-only" htmlFor="session-note-text">
              {subjectNoteType === "future" ? "Future Note" : "Lecture"}
            </label>
            <textarea
              id="session-note-text"
              value={subjectNoteDraft}
              onChange={(event) => setSubjectNoteDraft(event.target.value)}
              maxLength={10000}
              placeholder={
                subjectNoteType === "future"
                  ? "สิ่งที่ต้องทำหรือเตรียมต่อไป..."
                  : "หัวข้อหรือสรุปจาก Lecture..."
              }
              rows={7}
            />
            <div className="session-note-editor-actions">
              <button type="button" onClick={() => setOpenSessionNoteId(null)}>
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={() => void saveSessionNote(noteSession)}
                disabled={isSavingSubjectNote}
              >
                {isSavingSubjectNote ? "กำลังบันทึก..." : "บันทึก"}
              </button>
            </div>
          </section>
        </div>
      )}

      {isActivityModalOpen && (
        <div
          className="activity-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget)
              handleCloseActivityModal();
          }}
        >
          <form className="activity-modal" onSubmit={addDetailedActivity}>
            <div className="activity-modal-header">
              <h2>เพิ่มกิจกรรม</h2>
              <button
                type="button"
                className="activity-modal-close"
                onClick={handleCloseActivityModal}
                aria-label="ปิด"
              >
                ×
              </button>
            </div>
            <label>
              ชื่อกิจกรรม
              <input
                value={activityName}
                onChange={(event) => setActivityName(event.target.value)}
                placeholder="เช่น ทำการบ้านคณิต"
                maxLength={100}
                required
              />
            </label>
            <div className="activity-modal-grid">
              <label>
                ประเภทกิจกรรม
                <select
                  value={activityType}
                  onChange={(event) =>
                    setActivityType(
                      event.target.value as
                        | "study"
                        | "homework"
                        | "project"
                        | "review",
                    )
                  }
                  required
                >
                  <option value="study">อ่านหนังสือ</option>
                  <option value="homework">การบ้าน</option>
                  <option value="project">Project</option>
                  <option value="review">ทบทวน</option>
                </select>
              </label>
              <label>
                รายวิชา
                <select
                  value={activityCourseKey}
                  onChange={(event) => setActivityCourseKey(event.target.value)}
                >
                  <option value="">เลือกวิชา</option>
                  {activityCourses.map((course) => (
                    <option key={course.key} value={course.key}>
                      {course.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              รายละเอียดกิจกรรม
              <textarea
                value={activityDetails}
                onChange={(event) => setActivityDetails(event.target.value)}
                placeholder="รายละเอียดเพิ่มเติม"
                rows={3}
                maxLength={1000}
              />
            </label>
            <label>
              เวลาที่ใช้ในการทำกิจกรรม (ชั่วโมง)
              <input
                type="number"
                min="0.25"
                step="0.25"
                value={activityDuration}
                onChange={(event) => setActivityDuration(event.target.value)}
              />
            </label>
            <div className="activity-modal-grid">
              <label>
                วันที่เริ่ม
                <input
                  type="date"
                  value={activityStartDate}
                  onChange={(event) => setActivityStartDate(event.target.value)}
                />
              </label>
              <label>
                วันที่สิ้นสุด
                <input
                  type="date"
                  value={activityEndDate}
                  onChange={(event) => setActivityEndDate(event.target.value)}
                />
              </label>
              <label>
                เวลาเริ่ม
                <input
                  type="time"
                  value={activityStartTime}
                  onChange={(event) => setActivityStartTime(event.target.value)}
                />
              </label>
              <label>
                เวลาสิ้นสุด
                <input
                  type="time"
                  value={activityEndTime}
                  onChange={(event) => setActivityEndTime(event.target.value)}
                />
              </label>
            </div>
            <div className="activity-modal-actions">
              <button type="button" onClick={handleCancelActivityModal}>
                ยกเลิก
              </button>
              <button type="submit">เพิ่มตาราง</button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
