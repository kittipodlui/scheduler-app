'use client';

import { useState } from 'react';
import AppNavigation from './app-navigation';
import { useAnalyticsData } from './use-analytics-data';

const dayLabels = ['จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.', 'อา.'];
const completedDayColors = ['#4e79a7', '#4f8c78', '#c7953d', '#8876b5', '#cc7563', '#4e98a2', '#718096'];
const activityLabels = {
  study: 'อ่านหนังสือ',
  homework: 'การบ้าน',
  project: 'Project',
  review: 'ทบทวน',
} as const;

function getWeekStartDate(date = new Date()): string {
  const monday = new Date(date);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const year = monday.getFullYear();
  const month = String(monday.getMonth() + 1).padStart(2, '0');
  const day = String(monday.getDate()).padStart(2, '0');
  return year + '-' + month + '-' + day;
}

function normalizeWeekStartDate(dateKey: string): string {
  const date = new Date(dateKey + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

function shiftWeek(dateKey: string, weeks: number): string {
  const date = new Date(dateKey + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + weeks * 7);
  return date.toISOString().slice(0, 10);
}

function formatWeekRange(startDateKey: string): string {
  const start = new Date(startDateKey + 'T00:00:00Z');
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  const formatter = new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return formatter.format(start) + ' – ' + formatter.format(end);
}

function formatHours(hours: number): string {
  return Number.isInteger(hours) ? String(hours) : String(Number(hours.toFixed(2)));
}

function getHourScale(values: number[]) {
  const maximum = Math.max(0, ...values);
  const step = maximum <= 4 ? 1 : maximum <= 10 ? 2 : Math.ceil(maximum / 5);
  const max = Math.max(step, Math.ceil(maximum / step) * step);
  return {
    max,
    ticks: Array.from({ length: Math.floor(max / step) + 1 }, (_, index) => max - index * step),
  };
}

function StudyHoursChart({ days }: {
  days: Array<{ label: string; planned: number; completed: number }>;
}) {
  const { max, ticks } = getHourScale(days.flatMap((day) => [day.planned, day.completed]));
  const left = 62;
  const top = 18;
  const plotWidth = 666;
  const plotHeight = 218;
  const bottom = top + plotHeight;
  const groupWidth = plotWidth / Math.max(days.length, 1);
  const barWidth = Math.min(22, (groupWidth - 12) / 2);
  const y = (value: number) => bottom - (value / max) * plotHeight;

  return (
    <svg className="analytics-chart-svg" viewBox="0 0 760 300" role="img" aria-label="กราฟแท่งเปรียบเทียบชั่วโมงอ่านตามแผนและที่อ่านเสร็จรายวัน">
      <text x="0" y="0" transform={'translate(15 ' + (top + plotHeight / 2) + ') rotate(-90)'} textAnchor="middle" className="analytics-axis-title">ชั่วโมงอ่าน (ชม.)</text>
      {ticks.map((tick) => (
        <g key={tick}>
          <line x1={left} x2={left + plotWidth} y1={y(tick)} y2={y(tick)} className="analytics-grid-line" />
          <text x={left - 10} y={y(tick) + 4} textAnchor="end" className="analytics-axis-label">{tick}</text>
        </g>
      ))}
      <line x1={left} x2={left + plotWidth} y1={bottom} y2={bottom} className="analytics-axis-line" />
      {days.map((day, index) => {
        const center = left + index * groupWidth + groupWidth / 2;
        const plannedHeight = (day.planned / max) * plotHeight;
        const completedHeight = (day.completed / max) * plotHeight;
        return (
          <g key={day.label}>
            <rect x={center - barWidth - 2} y={y(day.planned)} width={barWidth} height={plannedHeight} rx="3" fill="#cbd5d1">
              <title>{day.label + ' ตามแผน ' + formatHours(day.planned) + ' ชั่วโมง'}</title>
            </rect>
            <rect x={center + 2} y={y(day.completed)} width={barWidth} height={completedHeight} rx="3" fill={completedDayColors[index % completedDayColors.length]}>
              <title>{day.label + ' อ่านเสร็จ ' + formatHours(day.completed) + ' ชั่วโมง'}</title>
            </rect>
            {day.planned > 0 && <text x={center - barWidth / 2 - 2} y={Math.max(top + 12, y(day.planned) - 6)} textAnchor="middle" className="analytics-value-label analytics-value-planned">{formatHours(day.planned)}</text>}
            {day.completed > 0 && <text x={center + barWidth / 2 + 2} y={Math.max(top + 12, y(day.completed) - 6)} textAnchor="middle" className="analytics-value-label analytics-value-actual" style={{ fill: completedDayColors[index % completedDayColors.length] }}>{formatHours(day.completed)}</text>}
            <text x={center} y={bottom + 22} textAnchor="middle" className="analytics-axis-label">{day.label}</text>
          </g>
        );
      })}
      <text x={left + plotWidth / 2} y="286" textAnchor="middle" className="analytics-axis-title">วันในสัปดาห์</text>
    </svg>
  );
}

function SubjectWeightChart({ subjects }: {
  subjects: Array<{ key: string; label: string; color: string; targetPercent: number; completedHours: number }>;
}) {
  const width = 760;
  const left = 64;
  const top = 18;
  const plotWidth = 660;
  const plotHeight = 218;
  const bottom = top + plotHeight;
  const groupWidth = plotWidth / Math.max(subjects.length, 1);
  const barWidth = Math.min(22, (groupWidth - 12) / 2);
  const totalCompleted = subjects.reduce((total, subject) => total + subject.completedHours, 0);
  const y = (value: number) => bottom - (value / 100) * plotHeight;

  return (
    <div className="analytics-subject-chart-wrap">
      <div className="analytics-chart-scroll">
      <svg className="analytics-chart-svg" viewBox={'0 0 ' + width + ' 320'} role="img" aria-label="กราฟเปรียบเทียบ Weight เป้าหมายกับสัดส่วนชั่วโมงอ่านเสร็จจริงของแต่ละวิชา">
        <text x="0" y="0" transform={'translate(15 ' + (top + plotHeight / 2) + ') rotate(-90)'} textAnchor="middle" className="analytics-axis-title">สัดส่วน (%)</text>
        {[100, 75, 50, 25, 0].map((tick) => (
          <g key={tick}>
            <line x1={left} x2={left + plotWidth} y1={y(tick)} y2={y(tick)} className="analytics-grid-line" />
            <text x={left - 10} y={y(tick) + 4} textAnchor="end" className="analytics-axis-label">{tick}%</text>
          </g>
        ))}
        <line x1={left} x2={left + plotWidth} y1={bottom} y2={bottom} className="analytics-axis-line" />
        {subjects.map((subject, index) => {
          const center = left + index * groupWidth + groupWidth / 2;
          const actualPercent = totalCompleted > 0 ? (subject.completedHours / totalCompleted) * 100 : null;
          const label = subject.label.length > 12 ? subject.label.slice(0, 11) + '…' : subject.label;
          return (
            <g key={subject.key}>
              <rect x={center - barWidth - 2} y={y(subject.targetPercent)} width={barWidth} height={(subject.targetPercent / 100) * plotHeight} rx="3" fill="#cbd5d1">
                <title>{subject.label + ': Weight เป้าหมาย ' + subject.targetPercent + '%'}</title>
              </rect>
              <rect x={center + 2} y={y(actualPercent ?? 0)} width={barWidth} height={((actualPercent ?? 0) / 100) * plotHeight} rx="3" fill={subject.color} opacity={actualPercent === null ? 0.15 : 1}>
                <title>{actualPercent === null ? subject.label + ': ยังไม่มีชั่วโมงอ่านเสร็จ' : subject.label + ': สัดส่วนอ่านเสร็จจริง ' + actualPercent.toFixed(1) + '%'}</title>
              </rect>
              <text x={center - barWidth / 2 - 2} y={Math.max(top + 12, y(subject.targetPercent) - 6)} textAnchor="middle" className="analytics-value-label analytics-value-planned" style={{ fill: '#66736c' }}>{subject.targetPercent}%</text>
              {actualPercent !== null && <text x={center + barWidth / 2 + 2} y={Math.max(top + 12, y(actualPercent) - 6)} textAnchor="middle" className="analytics-value-label analytics-value-actual" style={{ fill: subject.color }}>{actualPercent.toFixed(0)}%</text>}
              <text x={center} y={bottom + 19} textAnchor="middle" className="analytics-axis-label" style={{ fill: subject.color, fontWeight: 700 }}>{label}</text>
            </g>
          );
        })}
        <text x={left + plotWidth / 2} y="306" textAnchor="middle" className="analytics-axis-title">รายวิชา</text>
      </svg>
      </div>
      {totalCompleted === 0 && <p className="analytics-chart-note">ยังไม่มีชั่วโมงอ่านที่ทำเสร็จ จึงยังคำนวณสัดส่วนจริงไม่ได้</p>}
    </div>
  );
}

function WeeklyTrendChart({ weeks }: {
  weeks: Array<{ weekStartDate: string; label: string; plannedSessions: number; completedSessions: number; completionPercent: number | null }>;
}) {
  const left = 64;
  const top = 22;
  const plotWidth = 656;
  const plotHeight = 208;
  const bottom = top + plotHeight;
  const x = (index: number) => left + (weeks.length <= 1 ? plotWidth / 2 : (index / (weeks.length - 1)) * plotWidth);
  const y = (value: number) => bottom - (value / 100) * plotHeight;
  const hasData = weeks.some((week) => week.completionPercent !== null);

  return (
    <div className="analytics-trend-wrap">
      <div className="analytics-chart-scroll">
      <svg className="analytics-chart-svg" viewBox="0 0 760 300" role="img" aria-label="กราฟเส้นแสดงเปอร์เซ็นต์การทำตามตารางในช่วง 8 สัปดาห์ล่าสุด">
        <text x="0" y="0" transform={'translate(15 ' + (top + plotHeight / 2) + ') rotate(-90)'} textAnchor="middle" className="analytics-axis-title">ทำสำเร็จ (%)</text>
        {[100, 75, 50, 25, 0].map((tick) => (
          <g key={tick}>
            <line x1={left} x2={left + plotWidth} y1={y(tick)} y2={y(tick)} className="analytics-grid-line" />
            <text x={left - 10} y={y(tick) + 4} textAnchor="end" className="analytics-axis-label">{tick}%</text>
          </g>
        ))}
        <line x1={left} x2={left + plotWidth} y1={bottom} y2={bottom} className="analytics-axis-line" />
        {weeks.slice(0, -1).map((week, index) => {
          const next = weeks[index + 1];
          if (week.completionPercent === null || next.completionPercent === null) return null;
          return (
            <line key={week.weekStartDate + '-' + next.weekStartDate} x1={x(index)} y1={y(week.completionPercent)} x2={x(index + 1)} y2={y(next.completionPercent)} className="analytics-trend-line" />
          );
        })}
        {weeks.map((week, index) => (
          <g key={week.weekStartDate}>
            {week.completionPercent !== null && (
              <circle cx={x(index)} cy={y(week.completionPercent)} r="4.5" className="analytics-trend-point">
                <title>{week.label + ': ทำเสร็จ ' + week.completedSessions + ' จาก ' + week.plannedSessions + ' ช่วง (' + week.completionPercent + '%)'}</title>
              </circle>
            )}
            {week.completionPercent !== null && <text x={x(index)} y={Math.max(top + 12, y(week.completionPercent) - 10)} textAnchor="middle" className="analytics-value-label analytics-value-actual">{week.completionPercent}%</text>}
            <text x={x(index)} y={bottom + 20} textAnchor="middle" className="analytics-axis-label">{week.label}</text>
          </g>
        ))}
        <text x={left + plotWidth / 2} y="286" textAnchor="middle" className="analytics-axis-title">สัปดาห์ (วันเริ่มต้น)</text>
      </svg>
      </div>
      {!hasData && <p className="analytics-chart-note">ยังไม่มีประวัติตารางในช่วง 8 สัปดาห์ที่ผ่านมา เมื่อมีตารางและสถานะการอ่านแล้วกราฟจะแสดงผลที่นี่</p>}
      {hasData && <p className="analytics-chart-note">คำนวณจากจำนวนช่วงในตารางอัตโนมัติที่ทำเสร็จเทียบกับจำนวนช่วงทั้งหมดในแต่ละสัปดาห์ ไม่รวมช่วงเรียนที่เพิ่มเอง</p>}
    </div>
  );
}

export default function StudyAnalytics() {
  const [selectedWeekStartDate, setSelectedWeekStartDate] = useState(() => getWeekStartDate());
  const { data, error, isLoading } = useAnalyticsData(selectedWeekStartDate);
  const activityCategories = data?.categories.flatMap((category) => category.activityCategories.map((item) => ({
    ...item,
    categoryName: category.categoryName,
    categoryId: category.categoryId,
  }))) ?? [];
  const rescheduledCount = data?.categories.reduce((total, category) => total + category.rescheduledCount, 0) ?? 0;
  const pendingHours = Math.max(0, (data?.summary.plannedHours ?? 0) - (data?.summary.completedHours ?? 0));
  const weeklyDays = dayLabels.map((label, dayIndex) => ({
    label,
    planned: data?.categories.reduce((total, category) => total + (category.weeklyProgress[dayIndex]?.plannedHours ?? 0), 0) ?? 0,
    completed: data?.categories.reduce((total, category) => total + (category.weeklyProgress[dayIndex]?.completedHours ?? 0), 0) ?? 0,
  }));
  const categoriesWithSubjects = data?.categories.filter((category) => category.subjects.some((subject) => subject.kind === 'subject')) ?? [];

  return (
    <main className="app-shell analytics-shell">
      <AppNavigation activePage="analytics" />
      <div className="analytics-content">
        <header className="analytics-page-header">
          <div>
            <p className="eyebrow">STUDY INSIGHTS</p>
            <h1>Analytics</h1>
            <p>ภาพรวมการเรียนและความคืบหน้าตามตาราง</p>
          </div>
        </header>

        {error && <p className="dashboard-error" role="alert">{error}</p>}

        <section className="analytics-week-filter" aria-label="เลือกสัปดาห์สำหรับวิเคราะห์">
          <button type="button" className="analytics-week-nav" aria-label="สัปดาห์ก่อนหน้า" onClick={() => setSelectedWeekStartDate((current) => shiftWeek(current, -1))}>‹</button>
          <label className="analytics-week-date-label">
            <span>วันเริ่มสัปดาห์ (วันจันทร์)</span>
            <input
              type="date"
              value={selectedWeekStartDate}
              onChange={(event) => {
                if (event.target.value) setSelectedWeekStartDate(normalizeWeekStartDate(event.target.value));
              }}
              aria-label="เลือกสัปดาห์ที่ต้องการวิเคราะห์"
            />
          </label>
          <button type="button" className="analytics-week-nav" aria-label="สัปดาห์ถัดไป" onClick={() => setSelectedWeekStartDate((current) => shiftWeek(current, 1))}>›</button>
          <button type="button" className="analytics-week-current" onClick={() => setSelectedWeekStartDate(getWeekStartDate())}>สัปดาห์นี้</button>
          <p className="analytics-week-range">ข้อมูลช่วง {formatWeekRange(selectedWeekStartDate)}</p>
        </section>

        <section className="analytics-overview" aria-labelledby="analytics-overview-title">
          <div className="analytics-section-heading">
            <div><p className="eyebrow">OVERVIEW</p><h2 id="analytics-overview-title">ภาพรวมประจำสัปดาห์</h2></div>
          </div>
          <div className="analytics-overview-grid">
            <article className="analytics-metric-card">
              <span>ชั่วโมงเรียน</span>
              <strong>{isLoading ? '—' : formatHours(data?.summary.completedHours ?? 0) + ' / ' + formatHours(data?.summary.plannedHours ?? 0)}</strong>
              <small>ชั่วโมงที่เรียนเสร็จ / ตามแผน</small>
            </article>
            <article className="analytics-metric-card">
              <span>งานที่เสร็จ</span>
              <strong>{isLoading ? '—' : (data?.summary.completedTaskCount ?? 0) + ' / ' + (data?.summary.taskCount ?? 0)}</strong>
              <small>กิจกรรมที่บันทึกไว้</small>
            </article>
            <article className="analytics-metric-card analytics-metric-accent">
              <span>ทำตามแผน</span>
              <strong>{isLoading ? '—' : (data?.summary.completionPercent ?? 0) + '%'}</strong>
              <div className="analytics-progress-track"><span style={{ width: (data?.summary.completionPercent ?? 0) + '%' }} /></div>
            </article>
            <article className="analytics-metric-card">
              <span>จำนวนวิชา</span>
              <strong>{isLoading ? '—' : data?.summary.subjectCount ?? 0}</strong>
              <small>{data?.summary.categoryCount ?? 0} หมวดเรียน</small>
            </article>
          </div>
        </section>

        <section className="analytics-section" aria-labelledby="weekly-hours-title">
          <div className="analytics-section-heading">
            <div><p className="eyebrow">PLANNED VS COMPLETED</p><h2 id="weekly-hours-title">ชั่วโมงอ่านรายวัน: ตามแผนเทียบกับอ่านเสร็จ</h2></div>
            <div className="analytics-legend"><span className="analytics-legend-planned" /> ตามแผน <span className="analytics-legend-daily" /> อ่านเสร็จ (สีแยกตามวัน)</div>
          </div>
          {isLoading ? <p className="analytics-empty">กำลังโหลดข้อมูล...</p> : weeklyDays.some((day) => day.planned > 0) ? (
            <div className="analytics-chart-card">
              <div className="analytics-chart-scroll">
                <StudyHoursChart days={weeklyDays} />
              </div>
              <p className="analytics-chart-note">แสดงเฉพาะชั่วโมงอ่านของสัปดาห์ที่เลือก จากตารางและช่วงเรียนที่อยู่ในสัปดาห์นั้น</p>
            </div>
          ) : <p className="analytics-empty">ยังไม่มีตารางเรียนที่นำมาวิเคราะห์ได้</p>}
        </section>

        <section className="analytics-section" aria-labelledby="weight-share-title">
          <div className="analytics-section-heading">
            <div><p className="eyebrow">TARGET WEIGHT VS ACTUAL</p><h2 id="weight-share-title">Weight เป้าหมายเทียบกับสัดส่วนอ่านเสร็จจริงรายวิชา</h2></div>
            <div className="analytics-legend"><span className="analytics-legend-planned" /> Weight เป้าหมาย (สีอ่อน) <span className="analytics-legend-done" /> สัดส่วนจริง (สีเข้ม)</div>
          </div>
          {isLoading ? <p className="analytics-empty">กำลังโหลดข้อมูล...</p> : categoriesWithSubjects.length ? (
            <div className="analytics-category-charts">
              {categoriesWithSubjects.map((category) => (
                <article className="analytics-chart-card" key={category.categoryId}>
                  <div className="analytics-chart-card-heading">
                    <h3>{category.categoryName}</h3>
                    <span>เปรียบเทียบภายในหมวดนี้</span>
                  </div>
                  <SubjectWeightChart subjects={category.subjects.filter((subject) => subject.kind === 'subject')} />
                  <p className="analytics-chart-note">เปรียบเทียบ Weight เป้าหมายกับสัดส่วนชั่วโมงที่อ่านเสร็จจริงของแต่ละวิชาในหมวดเดียวกัน</p>
                </article>
              ))}
            </div>
          ) : <p className="analytics-empty">ยังไม่มีรายวิชาให้เปรียบเทียบ Weight</p>}
        </section>

        <section className="analytics-section" aria-labelledby="weekly-trend-title">
          <div className="analytics-section-heading">
            <div><p className="eyebrow">8-WEEK CONSISTENCY</p><h2 id="weekly-trend-title">แนวโน้มอัตราทำตามตาราง 8 สัปดาห์ก่อนถึงสัปดาห์ที่เลือก</h2></div>
          </div>
          {isLoading ? <p className="analytics-empty">กำลังโหลดข้อมูล...</p> : (
            <div className="analytics-chart-card">
              <WeeklyTrendChart weeks={data?.weeklyTrend ?? []} />
              <p className="analytics-chart-note">แสดงเปอร์เซ็นต์ช่วงอ่านที่ทำเสร็จย้อนหลัง โดยอ้างอิงจากสัปดาห์ที่เลือก (0–100%)</p>
            </div>
          )}
        </section>

        <section className="analytics-section" aria-labelledby="activity-categories-title">
          <div className="analytics-section-heading">
            <div><p className="eyebrow">ACTIVITY CATEGORIES</p><h2 id="activity-categories-title">ประเภทกิจกรรม</h2></div>
          </div>
          {isLoading ? <p className="analytics-empty">กำลังโหลดข้อมูล...</p> : activityCategories.length ? (
            <div className="analytics-category-grid">
              {activityCategories.map((item) => (
                <article className="analytics-category-card" key={item.categoryId + '-' + item.activityType}>
                  <div><strong>{item.activityType ? activityLabels[item.activityType] : 'ยังไม่ระบุประเภท'}</strong><span>{item.itemCount} งาน · เสร็จ {item.completedCount}</span></div>
                  <strong>{formatHours(item.completedHours)} / {formatHours(item.plannedHours)} ชม.</strong>
                </article>
              ))}
            </div>
          ) : <p className="analytics-empty">ยังไม่มีงานที่จัดประเภทไว้</p>}
        </section>

        <section className="analytics-section" aria-labelledby="performance-title">
          <div className="analytics-section-heading">
            <div><p className="eyebrow">SCHEDULE PERFORMANCE</p><h2 id="performance-title">ประสิทธิภาพตาราง</h2></div>
          </div>
          <div className="analytics-performance-grid">
            <article><span>ทำตามแผน</span><strong>{isLoading ? '—' : formatHours(data?.summary.completedHours ?? 0) + ' ชม.'}</strong></article>
            <article><span>ยังไม่ได้ทำ</span><strong>{isLoading ? '—' : formatHours(pendingHours) + ' ชม.'}</strong></article>
            <article><span>ปรับ/เลื่อนช่วง</span><strong>{isLoading ? '—' : rescheduledCount}</strong></article>
          </div>
        </section>
      </div>
    </main>
  );
}
