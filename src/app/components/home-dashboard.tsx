"use client";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { PriorityWeight } from "@/lib/subjects";
import { getSessionTimeRange, getStudyDayTimeline } from "@/lib/study-time";
import AppNavigation from "./app-navigation";
type StudyCategory = { id: number; name: string };
type StudyCourse = { key: string; label: string; categoryId: number; categoryName: string };
type HomeSubject = {
  key: string;
  label: string;
  kind: "subject" | "activity";
  categoryId: number;
  categoryName: string;
};
type HomeSchedule = {
  categoryId: number;
  categoryName: string;
  daysPerWeek: number;
  startTime: string;
  endTime: string;
  sessions: Array<{
    id: number;
    dayIndex: number;
    sessionIndex: number;
    subjectKey: string;
    isCompleted: boolean;
    lectureNotes?: string;
  }>;
};
type HomeManualBlock = {
  id: number;
  categoryId: number;
  categoryName: string;
  subjectLabel: string;
  dayIndex: number;
  scheduledDate: string | null;
  startTime: string;
  durationMinutes: number;
  blockType: "study" | "review" | "understanding" | "planning";
  isCompleted: boolean;
};
type StudyActivity = {
  id: number;
  categoryId: number;
  categoryName: string;
  activityType: "study" | "homework" | "project" | "review" | null;
  subjectKey: string | null;
  futureNote: string;
  lectureNotes: string;
  courseKey: string | null;
  title: string;
  durationHours: number;
  startDate: string | null;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
  isCompleted: boolean;
};
type HomeTodayItem = {
  id: string;
  activityId?: number;
  title: string;
  subtitle: string;
  time: string;
  status: "à¸¢à¸±à¸‡à¹„à¸¡à¹ˆà¹€à¸£à¸´à¹ˆà¸¡" | "à¸à¸³à¸¥à¸±à¸‡à¸—à¸³" | "à¹€à¸ªà¸£à¹‡à¸ˆà¹à¸¥à¹‰à¸§";
  lectureNotes?: string;
};
const activityTypeLabels = {
  study: "à¸­à¹ˆà¸²à¸™à¸«à¸™à¸±à¸‡à¸ªà¸·à¸­",
  homework: "à¸à¸²à¸£à¸šà¹‰à¸²à¸™",
  project: "Project",
  review: "à¸—à¸šà¸—à¸§à¸™",
} as const;
function toIsoDate(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
function toDisplayDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "";
}
function getLocalDateKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function getLocalWeekStartDate(date = new Date()): string {
  const monday = new Date(date);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return getLocalDateKey(monday);
}
function addDaysToDateKey(dateKey: string, days: number): string {
  const date = new Date(dateKey + "T00:00:00");
  date.setDate(date.getDate() + days);
  return getLocalDateKey(date);
}
async function fetchCategoryActivities(categoryId: number) {
  const response = await fetch(
    `/api/study-activities?categoryId=${categoryId}`,
  );
  if (response.status === 401) {
    window.location.replace("/login");
    throw new Error("à¸à¸£à¸¸à¸“à¸²à¹€à¸‚à¹‰à¸²à¸ªà¸¹à¹ˆà¸£à¸°à¸šà¸š");
  }
  const data = (await response.json()) as {
    activities?: StudyActivity[];
    courses?: StudyCourse[];
    error?: string;
  };
  if (!response.ok) throw new Error(data.error || "à¹‚à¸«à¸¥à¸”à¸à¸´à¸ˆà¸à¸£à¸£à¸¡à¹„à¸¡à¹ˆà¸ªà¸³à¹€à¸£à¹‡à¸ˆ");
  return { activities: data.activities ?? [], courses: data.courses ?? [] };
}
export default function HomeDashboard({ username }: { username: string }) {
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [categories, setCategories] = useState<StudyCategory[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [courses, setCourses] = useState<StudyCourse[]>([]);
  const [subjects, setSubjects] = useState<HomeSubject[]>([]);
  const [schedules, setSchedules] = useState<HomeSchedule[]>([]);
  const [manualBlocks, setManualBlocks] = useState<HomeManualBlock[]>([]);
  const [activities, setActivities] = useState<StudyActivity[]>([]);
  const [futureNoteActivity, setFutureNoteActivity] =
    useState<StudyActivity | null>(null);
  const [futureNoteDraft, setFutureNoteDraft] = useState("");
  const [futureNoteError, setFutureNoteError] = useState("");
  const [isSavingFutureNote, setIsSavingFutureNote] = useState(false);
  const [lecturePreview, setLecturePreview] = useState<{
    title: string;
    time: string;
    content: string;
    noteType: "Lecture" | "Future Note";
  } | null>(null);
  const [activityTitle, setActivityTitle] = useState("");
  const [activityType, setActivityType] = useState<
    NonNullable<StudyActivity["activityType"]> | ""
  >("");
  const [courseKey, setCourseKey] = useState("");
  const [weight, setWeight] = useState<PriorityWeight>(20);
  const [details, setDetails] = useState("");
  const [durationHours, setDurationHours] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [pageMessage, setPageMessage] = useState("");
  useEffect(() => {
    let cancelled = false;
    async function loadInitialData() {
      try {
        const response = await fetch("/api/categories");
        if (response.status === 401) {
          window.location.replace("/login");
          return;
        }
        const data = (await response.json()) as {
          categories?: StudyCategory[];
          error?: string;
        };
        if (!response.ok)
          throw new Error(data.error || "à¹‚à¸«à¸¥à¸”à¸«à¸¡à¸§à¸”à¸«à¸¡à¸¹à¹ˆà¹„à¸¡à¹ˆà¸ªà¸³à¹€à¸£à¹‡à¸ˆ");
        const nextCategories = data.categories ?? [];
        if (cancelled) return;
        setCategories(nextCategories);
        let savedCategoryId = "";
        try {
          savedCategoryId = window.localStorage.getItem("study-scheduler-default-category-id") ?? "";
        } catch {
          // Fall back to newest category when browser storage is unavailable.
        }
        const preferredCategory = nextCategories.find((category) => String(category.id) === savedCategoryId);
        const defaultCategory = preferredCategory ?? nextCategories[nextCategories.length - 1];
        if (!defaultCategory) return;
        setCategoryId(String(defaultCategory.id));
        try {
          window.localStorage.setItem("study-scheduler-default-category-id", String(defaultCategory.id));
        } catch {
          // Remember the default when browser storage is available.
        }

        const weekStartDate = getLocalWeekStartDate();
        const categoryDataSets = await Promise.all(nextCategories.map(async (category) => {
          const [categoryData, scheduleResponse, manualResponse] = await Promise.all([
            fetchCategoryActivities(category.id),
            fetch("/api/schedule?categoryId=" + category.id + "&weekStartDate=" + encodeURIComponent(weekStartDate)),
            fetch("/api/schedule/manual?categoryId=" + category.id),
          ]);
          if (scheduleResponse.status === 401 || manualResponse.status === 401) {
            window.location.replace("/login");
            throw new Error("\u0e01\u0e23\u0e38\u0e13\u0e32\u0e40\u0e02\u0e49\u0e32\u0e2a\u0e39\u0e48\u0e23\u0e30\u0e1a\u0e1a");
          }
          const scheduleData = await scheduleResponse.json() as {
            subjects?: Array<Omit<HomeSubject, "categoryId" | "categoryName">>;
            schedule?: Omit<HomeSchedule, "categoryId" | "categoryName"> | null;
            error?: string;
          };
          const manualData = await manualResponse.json() as {
            blocks?: Array<Omit<HomeManualBlock, "categoryId" | "categoryName">>;
            error?: string;
          };
          if (!scheduleResponse.ok)
            throw new Error(scheduleData.error || ("\u0e42\u0e2b\u0e25\u0e14\u0e15\u0e32\u0e23\u0e32\u0e07\u0e2b\u0e21\u0e27\u0e14 " + category.name + " \u0e44\u0e21\u0e48\u0e2a\u0e33\u0e40\u0e23\u0e47\u0e08"));
          if (!manualResponse.ok)
            throw new Error(manualData.error || ("\u0e42\u0e2b\u0e25\u0e14\u0e15\u0e32\u0e23\u0e32\u0e07\u0e40\u0e23\u0e35\u0e22\u0e19\u0e40\u0e2d\u0e07\u0e2b\u0e21\u0e27\u0e14 " + category.name + " \u0e44\u0e21\u0e48\u0e2a\u0e33\u0e40\u0e23\u0e47\u0e08"));
          return { category, categoryData, scheduleData, manualData };
        }));
        if (cancelled) return;

        const allSubjects: HomeSubject[] = [];
        const allSchedules: HomeSchedule[] = [];
        const allManualBlocks: HomeManualBlock[] = [];
        const allActivities: StudyActivity[] = [];
        const allCourses: StudyCourse[] = [];
        for (const result of categoryDataSets) {
          const { category, categoryData, scheduleData, manualData } = result;
          allSubjects.push(...(scheduleData.subjects ?? []).map((subject) => ({ ...subject, categoryId: category.id, categoryName: category.name })));
          if (scheduleData.schedule) allSchedules.push({ ...scheduleData.schedule, categoryId: category.id, categoryName: category.name });
          allManualBlocks.push(...(manualData.blocks ?? []).map((block) => ({ ...block, categoryId: category.id, categoryName: category.name, scheduledDate: block.scheduledDate ?? null })));
          allActivities.push(...categoryData.activities.map((activity) => ({ ...activity, categoryId: category.id, categoryName: category.name })));
          allCourses.push(...categoryData.courses.map((course) => ({ ...course, categoryId: category.id, categoryName: category.name })));
        }
        setActivities(allActivities);
        setCourses(allCourses);
        setSubjects(allSubjects);
        setSchedules(allSchedules);
        setManualBlocks(allManualBlocks);
      } catch (error) {
        if (!cancelled)
          setPageMessage(
            error instanceof Error ? error.message : "à¹‚à¸«à¸¥à¸”à¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¹„à¸¡à¹ˆà¸ªà¸³à¹€à¸£à¹‡à¸ˆ",
          );
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    void loadInitialData();
    return () => {
      cancelled = true;
    };
  }, []);
  async function addActivity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    setIsSaving(true);
    try {
      const selectedCategoryId = Number(categoryId);
      if (!Number.isSafeInteger(selectedCategoryId) || selectedCategoryId < 1) {
        throw new Error("à¸¢à¸±à¸‡à¹„à¸¡à¹ˆà¸¡à¸µà¸«à¸¡à¸§à¸”à¸«à¸¡à¸¹à¹ˆà¸ªà¸³à¸«à¸£à¸±à¸šà¸šà¸±à¸™à¸—à¸¶à¸à¸à¸´à¸ˆà¸à¸£à¸£à¸¡");
      }
      const startDateIso = toIsoDate(startDate);
      const endDateIso = toIsoDate(endDate);
      if (
        (startDate.trim() && !startDateIso) ||
        (endDate.trim() && !endDateIso)
      ) {
        throw new Error(
          "à¸à¸£à¸¸à¸“à¸²à¸à¸£à¸­à¸à¸§à¸±à¸™à¸—à¸µà¹ˆà¹ƒà¸™à¸£à¸¹à¸›à¹à¸šà¸š dd/mm/yyyy à¹à¸¥à¸°à¸•à¸£à¸§à¸ˆà¸ªà¸­à¸šà¸§à¸±à¸™à¸—à¸µà¹ˆà¸­à¸µà¸à¸„à¸£à¸±à¹‰à¸‡",
        );
      }
      if (startDateIso && endDateIso && startDateIso > endDateIso) {
        throw new Error("à¸§à¸±à¸™à¸—à¸µà¹ˆà¹€à¸£à¸´à¹ˆà¸¡à¸•à¹‰à¸­à¸‡à¹„à¸¡à¹ˆà¹€à¸à¸´à¸™à¸§à¸±à¸™à¸—à¸µà¹ˆà¸ªà¸´à¹‰à¸™à¸ªà¸¸à¸”");
      }
      const response = await fetch("/api/study-activities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categoryId: selectedCategoryId,
          title: activityTitle,
          activityType,
          courseKey: courseKey || null,
          weight,
          details,
          durationHours: Number(durationHours),
          startDate: startDateIso,
          endDate: endDateIso,
          startTime: startTime || null,
          endTime: endTime || null,
        }),
      });
      if (response.status === 401) {
        window.location.replace("/login");
        return;
      }
      const data = (await response.json()) as {
        activity?: StudyActivity;
        courses?: StudyCourse[];
        error?: string;
      };
      if (!response.ok || !data.activity)
        throw new Error(data.error || "à¸šà¸±à¸™à¸—à¸¶à¸à¸à¸´à¸ˆà¸à¸£à¸£à¸¡à¹„à¸¡à¹ˆà¸ªà¸³à¹€à¸£à¹‡à¸ˆ");
      const selectedCategoryName = categories.find((category) => category.id === selectedCategoryId)?.name ?? "";
      setActivities((current) => [{ ...(data.activity as StudyActivity), categoryId: selectedCategoryId, categoryName: selectedCategoryName }, ...current]);
      setPageMessage("à¸šà¸±à¸™à¸—à¸¶à¸à¸à¸´à¸ˆà¸à¸£à¸£à¸¡à¸¥à¸‡à¸à¸²à¸™à¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¹à¸¥à¹‰à¸§");
      setActivityTitle("");
      setActivityType("");
      setCourseKey("");
      setWeight(20);
      setDetails("");
      setDurationHours("");
      setStartDate("");
      setEndDate("");
      setStartTime("");
      setEndTime("");
      setIsAddModalOpen(false);
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "à¸šà¸±à¸™à¸—à¸¶à¸à¸à¸´à¸ˆà¸à¸£à¸£à¸¡à¹„à¸¡à¹ˆà¸ªà¸³à¹€à¸£à¹‡à¸ˆ",
      );
    } finally {
      setIsSaving(false);
    }
  }
  function startNewActivity() {
    // Reopening after clicking outside resumes the current draft.
    setFormError("");
    setIsAddModalOpen(true);
  }

  // Clicking outside only closes the modal; keep every form field unchanged.
  function closeAddModalKeepDraft() {
    setIsAddModalOpen(false);
  }

  function cancelNewActivity() {
    setActivityTitle("");
    setActivityType("");
    setCourseKey("");
    setWeight(20);
    setDetails("");
    setDurationHours("");
    setStartDate("");
    setEndDate("");
    setStartTime("");
    setEndTime("");
    setFormError("");
    setIsAddModalOpen(false);
  }
  function openFutureNote(activity: StudyActivity) {
    setFutureNoteActivity(activity);
    setFutureNoteDraft(activity.futureNote);
    setFutureNoteError("");
  }
  async function saveFutureNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!futureNoteActivity || !categoryId) return;
    if (!futureNoteActivity.subjectKey) {
      setFutureNoteError(
        "à¸à¸´à¸ˆà¸à¸£à¸£à¸¡à¸™à¸µà¹‰à¹„à¸¡à¹ˆà¸¡à¸µà¸§à¸´à¸Šà¸²à¸—à¸µà¹ˆà¹€à¸Šà¸·à¹ˆà¸­à¸¡à¹„à¸§à¹‰ à¸ˆà¸¶à¸‡à¸šà¸±à¸™à¸—à¸¶à¸ Future Note à¹„à¸¡à¹ˆà¹„à¸”à¹‰",
      );
      return;
    }
    setIsSavingFutureNote(true);
    setFutureNoteError("");
    try {
      const response = await fetch("/api/study-activities", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "futureNote",
          activityId: futureNoteActivity.id,
          categoryId: futureNoteActivity.categoryId,
          futureNote: futureNoteDraft,
        }),
      });
      if (response.status === 401) {
        window.location.replace("/login");
        return;
      }
      const data = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(data.error || "à¸šà¸±à¸™à¸—à¸¶à¸ Future Note à¹„à¸¡à¹ˆà¸ªà¸³à¹€à¸£à¹‡à¸ˆ");
      setActivities((current) =>
        current.map((activity) =>
          activity.id === futureNoteActivity.id
            ? { ...activity, futureNote: futureNoteDraft }
            : activity,
        ),
      );
      setPageMessage("à¸šà¸±à¸™à¸—à¸¶à¸ Future Note à¹à¸¥à¹‰à¸§");
      setFutureNoteActivity(null);
    } catch (error) {
      setFutureNoteError(
        error instanceof Error ? error.message : "à¸šà¸±à¸™à¸—à¸¶à¸ Future Note à¹„à¸¡à¹ˆà¸ªà¸³à¹€à¸£à¹‡à¸ˆ",
      );
    } finally {
      setIsSavingFutureNote(false);
    }
  }
  async function toggleActivityCompletion(activity: StudyActivity) {
    if (!categoryId) return;
    const nextIsCompleted = !activity.isCompleted;
    setPageMessage("");
    try {
      const response = await fetch("/api/study-activities", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "completion",
          activityId: activity.id,
          categoryId: activity.categoryId,
          isCompleted: nextIsCompleted,
        }),
      });
      if (response.status === 401) {
        window.location.replace("/login");
        return;
      }
      const data = (await response.json()) as {
        activity?: Partial<StudyActivity>;
        error?: string;
      };
      if (!response.ok || !data.activity)
        throw new Error(data.error || "à¹€à¸›à¸¥à¸µà¹ˆà¸¢à¸™à¸ªà¸–à¸²à¸™à¸°à¹„à¸¡à¹ˆà¸ªà¸³à¹€à¸£à¹‡à¸ˆ");
      setActivities((current) =>
        current.map((item) =>
          item.id === activity.id
            ? { ...item, isCompleted: Boolean(data.activity?.isCompleted) }
            : item,
        ),
      );
    } catch (error) {
      setPageMessage(
        error instanceof Error ? error.message : "à¹€à¸›à¸¥à¸µà¹ˆà¸¢à¸™à¸ªà¸–à¸²à¸™à¸°à¹„à¸¡à¹ˆà¸ªà¸³à¹€à¸£à¹‡à¸ˆ",
      );
    }
  }
  const now = new Date();
  const todayIndex = (now.getDay() + 6) % 7;
  const todayKey = getLocalDateKey(now);
  const currentWeekStartKey = getLocalWeekStartDate(now);
  const nextWeekStartKey = addDaysToDateKey(currentWeekStartKey, 7);
  const todayLabel = new Intl.DateTimeFormat("th-TH", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(now);
  const currentTime = String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");
  const todayItems: HomeTodayItem[] = [];
  const currentSubjects = new Map(subjects.map((subject) => [subject.categoryId + ":" + subject.key, subject]));
  for (const currentSchedule of schedules) {
    if (todayIndex >= currentSchedule.daysPerWeek) continue;
    const timeline = getStudyDayTimeline(currentSchedule.startTime, currentSchedule.endTime);
    for (const session of currentSchedule.sessions.filter((item) => item.dayIndex === todayIndex && item.sessionIndex < timeline.sessions.length)) {
      const time = getSessionTimeRange(currentSchedule.startTime, currentSchedule.endTime, session.sessionIndex);
      const [start, end] = time.split("\u2013");
      const inProgress = currentTime >= start && currentTime < end;
      const subject = currentSubjects.get(currentSchedule.categoryId + ":" + session.subjectKey);
      todayItems.push({
        id: "schedule-" + currentSchedule.categoryId + "-" + session.id,
        title: subject?.label ?? "\u0e0a\u0e48\u0e27\u0e07\u0e2d\u0e48\u0e32\u0e19\u0e2b\u0e19\u0e31\u0e07\u0e2a\u0e37\u0e2d",
        subtitle: "\u0e2d\u0e48\u0e32\u0e19\u0e2b\u0e19\u0e31\u0e07\u0e2a\u0e37\u0e2d \u00b7 " + currentSchedule.categoryName,
        time,
        lectureNotes: session.lectureNotes ?? "",
        status: session.isCompleted ? "\u0e40\u0e2a\u0e23\u0e47\u0e08\u0e41\u0e25\u0e49\u0e27" : inProgress ? "\u0e01\u0e33\u0e25\u0e31\u0e07\u0e17\u0e33" : "\u0e22\u0e31\u0e07\u0e44\u0e21\u0e48\u0e40\u0e23\u0e34\u0e48\u0e21",
      });
    }
  }
  todayItems.sort((first, second) => first.time.localeCompare(second.time));
  const subjectCount = new Set(subjects.filter((subject) => subject.kind === "subject").map((subject) => subject.categoryId + ":" + subject.key)).size;
  const weeklyManualBlocks = manualBlocks.filter((block) => !block.scheduledDate || (block.scheduledDate >= currentWeekStartKey && block.scheduledDate < nextWeekStartKey));
  const plannedHours = schedules.reduce((total, currentSchedule) => total + currentSchedule.sessions.length, 0) + weeklyManualBlocks.reduce((total, block) => total + block.durationMinutes / 60, 0);
  const selectedCourses = courses.filter((course) => course.categoryId === Number(categoryId));
  return (
    <main className="app-shell home-shell">
      <AppNavigation activePage="home" />
      <div className="home-content">
        Â  Â  Â  Â 
        <header className="home-greeting">

          <div>
             <p className="eyebrow">SMART STUDY PLANNER</p>
            Â  Â  <h1>{username}</h1>Â  Â  Â  Â  Â  Â 
            <p className="home-date">{todayLabel}</p>Â  Â  Â  Â  Â 
          </div>
          Â  Â  Â  Â  Â 
          <button
            className="home-add-activity"
            type="button"
            onClick={startNewActivity}
            disabled={categories.length === 0}
          >
            Â  Â  Â  Â  Â  Â  + à¹€à¸žà¸´à¹ˆà¸¡à¸à¸´à¸ˆà¸à¸£à¸£à¸¡ Â  Â  Â  Â  Â 
          </button>
          Â  Â  Â  Â 
        </header>
        Â  Â  Â  Â 
        <section className="home-summary home-summary-top" aria-label="à¸ªà¸£à¸¸à¸›à¸à¸²à¸£à¹€à¸£à¸µà¸¢à¸™">
          <article className="home-summary-item">
            <span>à¸§à¸´à¸Šà¸²à¸—à¸µà¹ˆà¸ˆà¸±à¸”à¹„à¸§à¹‰</span>
            <strong>{isLoading ? "â€”" : subjectCount}</strong>
          </article>
          <article className="home-summary-item">
            <span>à¸à¸´à¸ˆà¸à¸£à¸£à¸¡</span>
            <strong>{isLoading ? "â€”" : activities.length}</strong>
          </article>
          <article className="home-summary-item">
            <span>à¸Šà¸±à¹ˆà¸§à¹‚à¸¡à¸‡à¸•à¸²à¸¡à¹à¸œà¸™</span>
            <strong>
              {isLoading ? "â€”" : plannedHours.toFixed(1) + " à¸Šà¸¡."}
            </strong>
          </article>
        </section>

        {pageMessage && (
          <p className="home-message" role="status">
            {pageMessage}
          </p>
        )}
        Â  Â  Â  Â 
        <section className="home-today-section" aria-labelledby="today-heading">
          Â  Â  Â  Â  Â 
          <div className="home-section-heading">
            Â  Â  Â  Â  Â  Â 
            <div>
              Â  Â  Â  Â  Â  Â  Â  <p className="eyebrow"></p>Â  Â  Â  Â  Â  Â  Â 
              <h2 id="today-heading">à¸•à¸²à¸£à¸²à¸‡à¸§à¸±à¸™à¸™à¸µà¹‰</h2>Â  Â  Â  Â  Â  Â 
            </div>
            Â  Â  Â  Â  Â  Â  <span>{todayItems.length} à¸£à¸²à¸¢à¸à¸²à¸£</span>Â  Â  Â  Â  Â 
          </div>
          Â  Â  Â  Â  Â 
          {isLoading ? (
            <p className="home-empty">à¸à¸³à¸¥à¸±à¸‡à¹‚à¸«à¸¥à¸”à¸•à¸²à¸£à¸²à¸‡...</p>
          ) : todayItems.length ? (
            <div className="home-today-list">
              Â  Â  Â  Â  Â  Â  Â 
              {todayItems.map((item) => (
                <article className="home-today-row" key={item.id}>
                  Â  Â  Â  Â  Â  Â  Â  Â  Â 
Â  Â  Â  Â  Â 
                  Â  Â  Â  Â 
                  <div className="home-today-main">
                    Â  Â  Â  Â  Â  Â  Â  Â  Â  Â  <strong>{item.title}</strong>Â  Â  Â  Â  Â  Â 
                    Â  Â  Â  Â  <span>{item.subtitle}</span>
                    <time className="home-today-time">{item.time}</time>Â  Â  Â  Â  Â  Â  Â  Â  Â 
                  </div>
                  Â  Â  Â  Â  Â  Â  Â  Â  Â 
                  {item.activityId ? (
                    (() => {
                      const activity = activities.find(
                        (entry) => entry.id === item.activityId,
                      );
                      return activity ? (
                        <div className="home-today-actions">
                          Â  Â  Â  Â  Â  Â  Â  Â  Â  Â  Â  Â 
                          <button
                            type="button"
                            className={`home-status home-status-${activity.isCompleted ? "done" : "pending"}`}
                            aria-pressed={activity.isCompleted}
                            onClick={() =>
                              void toggleActivityCompletion(activity)
                            }
                          >
                            Â  Â  Â  Â  Â  Â  Â  Â  Â  Â  Â  Â  Â 
                            {activity.isCompleted ? "à¹€à¸ªà¸£à¹‡à¸ˆà¹à¸¥à¹‰à¸§" : "à¸¢à¸±à¸‡à¹„à¸¡à¹ˆà¹€à¸£à¸´à¹ˆà¸¡"}
                            Â  Â  Â  Â  Â  Â  Â  Â  Â  Â  Â  Â 
                          </button>
                          Â  Â  Â  Â  Â  Â  Â  Â  Â  Â  Â  Â 
                          <button
                            type="button"
                            className="home-note-link"
                            onClick={() => openFutureNote(activity)}
                          >
                            Future Note
                          </button>
                          {(activity.lectureNotes.trim() || activity.futureNote.trim()) && (
                            <button
                              type="button"
                              className="home-note-icon"
                              title={activity.lectureNotes.trim() ? "à¸”à¸¹ Lecture à¸—à¸µà¹ˆà¸šà¸±à¸™à¸—à¸¶à¸à¹„à¸§à¹‰" : "à¸”à¸¹ Future Note à¸—à¸µà¹ˆà¸šà¸±à¸™à¸—à¸¶à¸à¹„à¸§à¹‰"}
                              aria-label={`à¸”à¸¹à¹‚à¸™à¹‰à¸•à¸—à¸µà¹ˆà¸šà¸±à¸™à¸—à¸¶à¸à¹„à¸§à¹‰: ${activity.title}`}
                              onClick={() =>
                                setLecturePreview({
                                  title: activity.title,
                                  time: item.time,
                                  content: activity.lectureNotes.trim()
                                    ? activity.lectureNotes
                                    : activity.futureNote,
                                  noteType: activity.lectureNotes.trim() ? "Lecture" : "Future Note",
                                })
                              }
                            >
                              <svg
                                aria-hidden="true"
                                viewBox="0 0 24 24"
                                width="17"
                                height="17"
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
                          Â  Â  Â  Â  Â  Â  Â  Â  Â  Â  Â 
                        </div>
                      ) : null;
                    })()
                  ) : item.lectureNotes?.trim() ? (
                    <div className="home-today-actions">
                      <span className={`home-status home-status-${item.status === "à¹€à¸ªà¸£à¹‡à¸ˆà¹à¸¥à¹‰à¸§" ? "done" : item.status === "à¸à¸³à¸¥à¸±à¸‡à¸—à¸³" ? "active" : "pending"}`}>
                        {item.status}
                      </span>
                      <button
                        type="button"
                        className="home-note-icon"
                        title="à¸”à¸¹ Lecture à¸—à¸µà¹ˆà¸šà¸±à¸™à¸—à¸¶à¸à¹„à¸§à¹‰"
                        aria-label={`à¸”à¸¹ Lecture à¸—à¸µà¹ˆà¸šà¸±à¸™à¸—à¸¶à¸à¹„à¸§à¹‰: ${item.title}`}
                        onClick={() =>
                          setLecturePreview({
                            title: item.title,
                            time: item.time,
                            content: item.lectureNotes ?? "",
                            noteType: "Lecture",
                          })
                        }
                      >
                        <svg
                          aria-hidden="true"
                          viewBox="0 0 24 24"
                          width="17"
                          height="17"
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
                    </div>
                  ) : (
                    <span
                      className={`home-status home-status-${item.status === "à¹€à¸ªà¸£à¹‡à¸ˆà¹à¸¥à¹‰à¸§" ? "done" : item.status === "à¸à¸³à¸¥à¸±à¸‡à¸—à¸³" ? "active" : "pending"}`}
                    >
                      Â  Â  Â  Â  Â  Â  Â  Â  Â  Â  Â  {item.status}Â  Â  Â  Â  Â  Â  Â  Â  Â  Â 
                    </span>
                  )}
                  Â  Â  Â  Â  Â  Â  Â  Â 
                </article>
              ))}
              Â  Â  Â  Â  Â  Â 
            </div>
          ) : (
            <div className="home-empty">
              Â  Â  Â  Â  Â  Â  Â  <strong>à¸§à¸±à¸™à¸™à¸µà¹‰à¸¢à¸±à¸‡à¹„à¸¡à¹ˆà¸¡à¸µà¸•à¸²à¸£à¸²à¸‡</strong>Â  Â  Â  Â  Â  Â  Â 
              <span>à¹„à¸›à¸—à¸µà¹ˆà¸«à¸™à¹‰à¸² Schedule à¹€à¸žà¸·à¹ˆà¸­à¸ªà¸£à¹‰à¸²à¸‡à¸•à¸²à¸£à¸²à¸‡à¸«à¸£à¸·à¸­à¹€à¸žà¸´à¹ˆà¸¡à¸Šà¹ˆà¸§à¸‡à¹€à¸£à¸µà¸¢à¸™à¹€à¸­à¸‡</span>
              Â  Â  Â  Â  Â  Â 
            </div>
          )}
          Â  Â  Â  Â 
        </section>
        {isAddModalOpen && (
          <div
            className="mock-add-overlay"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-schedule-title"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                closeAddModalKeepDraft();
              }
            }}
          >
            Â  Â  Â  Â  Â  Â 
            <form
              className="mock-form-card"
              onSubmit={addActivity}
              onMouseDown={(event) => event.stopPropagation()}
            >
              Â  Â  Â  Â  Â  Â  Â 
              <div id="add-schedule-title" className="mock-form-header">
                à¹€à¸žà¸´à¹ˆà¸¡à¸•à¸²à¸£à¸²à¸‡à¹ƒà¸«à¸¡à¹ˆ
              </div>
              Â  Â  Â  Â  Â  Â  Â 
              <label className="field-block">
                Â  Â  Â  Â  Â  Â  Â  Â  <span>à¸Šà¸·à¹ˆà¸­à¸à¸´à¸ˆà¸à¸£à¸£à¸¡</span>Â  Â  Â  Â  Â  Â  Â  Â 
                <input
                  value={activityTitle}
                  onChange={(event) => setActivityTitle(event.target.value)}
                  maxLength={100}
                  required
                />
                Â  Â  Â  Â  Â  Â  Â 
              </label>
              Â  Â  Â  Â  Â  Â  Â 
              <div className="two-column">
                Â  Â  Â  Â  Â  Â  Â  Â 
                <label className="field-block">
                  Â  Â  Â  Â  Â  Â  Â  Â  Â  <span>à¸›à¸£à¸°à¹€à¸ à¸—à¸à¸´à¸ˆà¸à¸£à¸£à¸¡</span>Â  Â  Â  Â  Â  Â  Â  Â  Â 
                  <select
                    value={activityType}
                    onChange={(event) =>
                      setActivityType(
                        event.target.value as
                          | NonNullable<StudyActivity["activityType"]>
                          | "",
                      )
                    }
                    required
                  >
                    Â  Â  Â  Â  Â  Â  Â  Â  Â  Â 
                    <option value="" disabled>
                      à¹€à¸¥à¸·à¸­à¸à¸›à¸£à¸°à¹€à¸ à¸—
                    </option>
                    Â  Â  Â  Â  Â  Â  Â  Â  Â  Â 
                    {Object.entries(activityTypeLabels).map(
                      ([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ),
                    )}
                    Â  Â  Â  Â  Â  Â  Â  Â  Â 
                  </select>
                  Â  Â  Â  Â  Â  Â  Â  Â 
                </label>
                Â  Â  Â  Â  Â  Â  Â  Â 
                <label className="field-block">
                  Â  Â  Â  Â  Â  Â  Â  Â  Â  <span>à¸£à¸²à¸¢à¸§à¸´à¸Šà¸²</span>Â  Â  Â  Â  Â  Â  Â  Â  Â 
                  <select
                    value={courseKey}
                    onChange={(event) => setCourseKey(event.target.value)}
                  >
                    Â  Â  Â  Â  Â  Â  Â  Â  Â  Â  <option value="">à¹„à¸¡à¹ˆà¸œà¸¹à¸à¸§à¸´à¸Šà¸²</option>Â  Â 
                    Â  Â  Â  Â  Â  Â  Â  Â 
                    {selectedCourses.map((course) => (
                      <option key={course.key} value={course.key}>
                        {course.label}
                      </option>
                    ))}
                    Â  Â  Â  Â  Â  Â  Â  Â  Â 
                  </select>
                  Â  Â  Â  Â  Â  Â  Â  Â 
                </label>
                Â  Â  Â  Â  Â  Â  Â  Â 
                
                Â  Â  Â  Â  Â  Â  Â 
              </div>
              Â  Â  Â  Â  Â  Â  Â 
              {selectedCourses.length === 0 && (
                <small className="mock-form-hint">
                  à¸¢à¸±à¸‡à¹„à¸¡à¹ˆà¸¡à¸µà¸£à¸²à¸¢à¸§à¸´à¸Šà¸²à¹ƒà¸™à¸à¸²à¸™à¸‚à¹‰à¸­à¸¡à¸¹à¸¥ à¸ªà¸²à¸¡à¸²à¸£à¸–à¸šà¸±à¸™à¸—à¸¶à¸à¹‚à¸”à¸¢à¹„à¸¡à¹ˆà¸œà¸¹à¸à¸§à¸´à¸Šà¸²à¹„à¸”à¹‰
                </small>
              )}
              Â  Â  Â  Â  Â  Â  Â 
              <label className="field-block">
                Â  Â  Â  Â  Â  Â  Â  Â  <span>à¸£à¸²à¸¢à¸¥à¸°à¹€à¸­à¸µà¸¢à¸”à¸à¸´à¸ˆà¸à¸£à¸£à¸¡</span>Â  Â  Â  Â  Â  Â  Â  Â 
                <textarea
                  rows={3}
                  maxLength={1000}
                  value={details}
                  onChange={(event) => setDetails(event.target.value)}
                />
                Â  Â  Â  Â  Â  Â  Â 
              </label>
              Â  Â  Â  Â  Â  Â  Â 
              <label className="field-block">
                Â  Â  Â  Â  Â  Â  Â  Â  <span>à¹€à¸§à¸¥à¸²à¸—à¸µà¹ˆà¹ƒà¸Šà¹‰à¹ƒà¸™à¸à¸²à¸£à¸—à¸³à¸à¸´à¸ˆà¸à¸£à¸£à¸¡ (à¸Šà¸±à¹ˆà¸§à¹‚à¸¡à¸‡)</span>Â 
                Â  Â  Â  Â  Â  Â  Â 
                <input
                  type="number"
                  min="0.25"
                  max="24"
                  step="0.25"
                  value={durationHours}
                  onChange={(event) => setDurationHours(event.target.value)}
                  required
                />
                Â  Â  Â  Â  Â  Â  Â 
              </label>
              Â  Â  Â  Â  Â  Â  Â 
              <div className="two-column">
                Â  Â  Â  Â  Â  Â  Â  Â 
                <label className="field-block">
                  Â  Â  Â  Â  Â  Â  Â  Â  Â  <span>à¸§à¸±à¸™à¸—à¸µà¹ˆà¹€à¸£à¸´à¹ˆà¸¡</span>Â  Â  Â  Â  Â  Â  Â  Â  Â 
                  <input
                    type="date"
                    lang="en-GB"
                    value={toIsoDate(startDate) ?? ""}
                    onChange={(event) =>
                      setStartDate(toDisplayDate(event.target.value))
                    }
                  />
                  Â  Â  Â  Â  Â  Â  Â  Â 
                </label>
                Â  Â  Â  Â  Â  Â  Â  Â 
                <label className="field-block">
                  Â  Â  Â  Â  Â  Â  Â  Â  Â  <span>à¸§à¸±à¸™à¸—à¸µà¹ˆà¸ªà¸´à¹‰à¸™à¸ªà¸¸à¸”</span>Â  Â  Â  Â  Â  Â  Â  Â  Â 
                  <input
                    type="date"
                    lang="en-GB"
                    value={toIsoDate(endDate) ?? ""}
                    onChange={(event) =>
                      setEndDate(toDisplayDate(event.target.value))
                    }
                  />
                  Â  Â  Â  Â  Â  Â  Â  Â 
                </label>
                Â  Â  Â  Â  Â  Â  Â 
              </div>
              Â  Â  Â  Â  Â  Â  Â 
              <div className="two-column two-column-last">
                Â  Â  Â  Â  Â  Â  Â  Â 
                <label className="field-block">
                  Â  Â  Â  Â  Â  Â  Â  Â  Â  <span>à¹€à¸§à¸¥à¸²à¹€à¸£à¸´à¹ˆà¸¡</span>Â  Â  Â  Â  Â  Â  Â  Â  Â 
                  <input
                    type="time"
                    value={startTime}
                    onChange={(event) => setStartTime(event.target.value)}
                  />
                  Â  Â  Â  Â  Â  Â  Â  Â 
                </label>
                Â  Â  Â  Â  Â  Â  Â  Â 
                <label className="field-block">
                  Â  Â  Â  Â  Â  Â  Â  Â  Â  <span>à¹€à¸§à¸¥à¸²à¸ªà¸´à¹‰à¸™à¸ªà¸¸à¸”</span>Â  Â  Â  Â  Â  Â  Â  Â  Â 
                  <input
                    type="time"
                    value={endTime}
                    onChange={(event) => setEndTime(event.target.value)}
                  />
                  Â  Â  Â  Â  Â  Â  Â  Â 
                </label>
                Â  Â  Â  Â  Â  Â  Â 
              </div>
              Â  Â  Â  Â  Â  Â  Â 
              {formError && (
                <p className="dashboard-error" role="alert">
                  {formError}
                </p>
              )}
              Â  Â  Â  Â  Â  Â  Â 
              <div className="mock-form-actions">
                Â  Â  Â  Â  Â  Â  Â  Â 
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={cancelNewActivity}
                >
                  à¸¢à¸à¹€à¸¥à¸´à¸
                </button>
                Â  Â  Â  Â  Â  Â  Â  Â 
                <button
                  type="submit"
                  className="primary-btn"
                  disabled={isSaving || isLoading || categories.length === 0}
                >
                  Â  Â  Â  Â  Â  Â  Â  Â  Â  {isSaving ? "à¸à¸³à¸¥à¸±à¸‡à¸šà¸±à¸™à¸—à¸¶à¸..." : "à¹€à¸žà¸´à¹ˆà¸¡à¸•à¸²à¸£à¸²à¸‡"}
                  Â  Â  Â  Â  Â  Â  Â  Â 
                </button>
                Â  Â  Â  Â  Â  Â  Â 
              </div>
              Â  Â  Â  Â  Â  Â 
            </form>
            Â  Â  Â  Â  Â 
          </div>
        )}
        Â  Â  Â  Â 
        {lecturePreview && (
          <div
            className="mock-note-overlay"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setLecturePreview(null);
            }}
          >
            <section
              className="mock-note-modal home-lecture-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="home-lecture-title"
            >
              <div className="note-header">
                <h3 id="home-lecture-title">{lecturePreview.noteType}</h3>
                <button
                  type="button"
                  className="close-note"
                  onClick={() => setLecturePreview(null)}
                  aria-label="à¸›à¸´à¸”"
                >
                  Ã—
                </button>
              </div>
              <p className="session-course">
                {lecturePreview.title} Â· {lecturePreview.time}
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
                  à¸›à¸´à¸”
                </button>
              </div>
            </section>
          </div>
        )}
        {futureNoteActivity && (
          <div
            className="mock-note-overlay"
            role="dialog"
            aria-modal="true"
            aria-labelledby="future-note-title"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget && !isSavingFutureNote) {
                setFutureNoteActivity(null);
              }
            }}
          >
            Â  Â  Â  Â  Â  Â 
            <form className="mock-note-modal" onSubmit={saveFutureNote}>
              Â  Â  Â  Â  Â  Â  Â 
              <div className="note-header">
                Â  Â  Â  Â  Â  Â  Â  Â  <h3 id="future-note-title">Future Note</h3>Â  Â  Â 
                Â  Â  Â  Â  Â 
                <button
                  type="button"
                  className="close-note"
                  onClick={() => setFutureNoteActivity(null)}
                  aria-label="à¸›à¸´à¸”"
                >
                  Ã—
                </button>
                Â  Â  Â  Â  Â  Â  Â 
              </div>
              Â  Â  Â  Â  Â  Â  Â 
              <p className="session-course">{futureNoteActivity.title}</p>Â  Â  Â 
              Â  Â  Â  Â 
              <textarea
                rows={6}
                maxLength={10000}
                value={futureNoteDraft}
                onChange={(event) => setFutureNoteDraft(event.target.value)}
                aria-label="Future Note"
              />
              Â  Â  Â  Â  Â  Â  Â 
              {futureNoteError && (
                <p className="dashboard-error" role="alert">
                  {futureNoteError}
                </p>
              )}
              Â  Â  Â  Â  Â  Â  Â 
              <div className="note-actions">
                Â  Â  Â  Â  Â  Â  Â  Â 
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => setFutureNoteActivity(null)}
                >
                  à¸¢à¸à¹€à¸¥à¸´à¸
                </button>
                Â  Â  Â  Â  Â  Â  Â  Â 
                <button
                  type="submit"
                  className="primary-btn"
                  disabled={isSavingFutureNote}
                >
                  {isSavingFutureNote ? "à¸à¸³à¸¥à¸±à¸‡à¸šà¸±à¸™à¸—à¸¶à¸..." : "à¸šà¸±à¸™à¸—à¸¶à¸"}
                </button>
                Â  Â  Â  Â  Â  Â  Â 
              </div>
              Â  Â  Â  Â  Â  Â 
            </form>
            Â  Â  Â  Â  Â 
          </div>
        )}
        Â  Â  Â 
      </div>
      Â  Â 
    </main>
  );
}
