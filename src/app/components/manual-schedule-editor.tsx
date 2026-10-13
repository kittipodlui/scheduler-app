'use client';

import { useEffect, useState } from 'react';
import { PRIORITY_WEIGHT_LEVELS } from '@/lib/subjects';
import type { PriorityWeight, SubjectPreference } from '@/lib/subjects';

type BlockType = 'study' | 'review' | 'understanding' | 'planning';
export type ManualBlock = {
  id: number;
  subjectKey: string;
  subjectLabel: string;
  subjectKind: 'subject' | 'activity';
  dayIndex: number;
  scheduledDate: string | null;
  startTime: string;
  durationMinutes: number;
  blockType: BlockType;
  isCompleted: boolean;
};

const dayNames = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์'];
const blockTypeLabels: Record<BlockType, string> = {
  study: 'เรียน',
  review: 'ทบทวน',
  understanding: 'ทำความเข้าใจ',
  planning: 'วางแผน',
};

function getEndTime(startTime: string, durationMinutes: number): string {
  const [hours, minutes] = startTime.split(':').map(Number);
  const end = hours * 60 + minutes + durationMinutes;
  return `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`;
}

function getDayIndexForDate(dateKey: string): number {
  return (new Date(dateKey + 'T00:00:00Z').getUTCDay() + 6) % 7;
}

function getDateForWeekDay(weekStartDate: string, dayIndex: number): string {
  const date = new Date(weekStartDate + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + dayIndex);
  return date.toISOString().slice(0, 10);
}

export default function ManualScheduleEditor({
  categoryId,
  subjects,
  isAddModalOpen,
  selectedDate,
  subjectScopeDate,
  preferredStartTime,
  onCloseAddModal,
  onSubjectsUpdated,
  onBlocksUpdated,
}: {
  categoryId: number;
  subjects: SubjectPreference[];
  isAddModalOpen: boolean;
  selectedDate: string | null;
  subjectScopeDate: string | null;
  preferredStartTime: string | null;
  onCloseAddModal: () => void;
  onSubjectsUpdated: (
    subjects: SubjectPreference[],
    availableSubjects: SubjectPreference[],
  ) => void;
  onBlocksUpdated: (blocks: ManualBlock[]) => void;
}) {
  const [blocks, setBlocks] = useState<ManualBlock[]>([]);
  const [subjectKey, setSubjectKey] = useState('');
  const [dayIndex, setDayIndex] = useState(0);
  const [startTime, setStartTime] = useState('18:00');
  const [durationMinutes, setDurationMinutes] = useState(45);
  const [weight, setWeight] = useState<PriorityWeight | null>(null);
  const [blockType, setBlockType] = useState<BlockType>('study');
  const selectedSubject = subjects.find(
    (subject) => subject.key === (subjectKey || subjects[0]?.key),
  );
  const displayedWeight = weight ?? selectedSubject?.weight ?? 20;
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!isAddModalOpen) return;
    // Prefill a clicked time slot only when the parent explicitly supplied one.
    // Reopening a dismissed modal should otherwise preserve the existing draft.
    if (preferredStartTime) {
      // This intentional synchronization applies a user's clicked empty time slot.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStartTime(preferredStartTime);
    }
  }, [isAddModalOpen, preferredStartTime]);

  useEffect(() => {
    let active = true;
    fetch(`/api/schedule/manual?categoryId=${categoryId}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'โหลดช่วง manual ไม่สำเร็จ');
        if (active) {
          const loadedBlocks = data.blocks as ManualBlock[];
          setBlocks(loadedBlocks);
          onBlocksUpdated(loadedBlocks);
        }
      })
      .catch((error: unknown) => {
        if (active) setMessage(error instanceof Error ? error.message : 'โหลดช่วง manual ไม่สำเร็จ');
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => { active = false; };
  }, [categoryId, onBlocksUpdated]);

  function closeAddModal() {
    // Clicking outside or the close icon hides the modal but keeps the draft.
    setMessage('');
    onCloseAddModal();
  }

  function cancelAddModal() {
    setSubjectKey('');
    setDayIndex(0);
    setStartTime('18:00');
    setDurationMinutes(45);
    setWeight(null);
    setBlockType('study');
    setMessage('');
    onCloseAddModal();
  }

  function resetAddForm() {
    setSubjectKey('');
    setDayIndex(0);
    setStartTime('18:00');
    setDurationMinutes(45);
    setWeight(null);
    setBlockType('study');
    setMessage('');
  }

  async function addBlock(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const selectedSubject = subjectKey || subjects[0]?.key;
    if (!selectedSubject) {
      setMessage('เพิ่มวิชาหรือกิจกรรมในหมวดนี้ก่อน');
      return;
    }
    setIsSaving(true);
    setMessage('');
    try {
      const response = await fetch('/api/schedule/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          categoryId,
          subjectKey: selectedSubject,
          dayIndex: selectedDate ? getDayIndexForDate(selectedDate) : dayIndex,
          scheduledDate: selectedDate ?? (
            subjectScopeDate ? getDateForWeekDay(subjectScopeDate, dayIndex) : null
          ),
          subjectScopeDate,
          startTime,
          durationMinutes,
          blockType,
          weight: displayedWeight,
        }),
      });
      const data = await response.json() as {
        error?: string;
        subjects?: SubjectPreference[];
        availableSubjects?: SubjectPreference[];
      };
      if (!response.ok) throw new Error(data.error || 'เพิ่มช่วงเรียนไม่สำเร็จ');
      if (data.subjects && data.availableSubjects) {
        onSubjectsUpdated(data.subjects, data.availableSubjects);
      }
      const refreshed = await fetch(`/api/schedule/manual?categoryId=${categoryId}`);
      const refreshedData = await refreshed.json();
      if (!refreshed.ok) throw new Error(refreshedData.error || 'โหลดช่วง manual ไม่สำเร็จ');
      const refreshedBlocks = refreshedData.blocks as ManualBlock[];
      setBlocks(refreshedBlocks);
      onBlocksUpdated(refreshedBlocks);
      resetAddForm();
      onCloseAddModal();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'เพิ่มช่วงเรียนไม่สำเร็จ');
    } finally {
      setIsSaving(false);
    }
  }

  async function updateCompletion(block: ManualBlock, isCompleted: boolean) {
    const response = await fetch('/api/schedule/manual', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categoryId, blockId: block.id, isCompleted }),
    });
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.error || 'อัปเดตสถานะไม่สำเร็จ');
      return;
    }
    setBlocks((current) => {
      const updated = current.map((item) =>
        item.id === block.id ? { ...item, isCompleted } : item,
      );
      onBlocksUpdated(updated);
      return updated;
    });
  }

  async function deleteBlock(blockId: number) {
    const response = await fetch('/api/schedule/manual', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categoryId, blockId }),
    });
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.error || 'ลบช่วงเรียนไม่สำเร็จ');
      return;
    }
    setBlocks((current) => {
      const updated = current.filter((block) => block.id !== blockId);
      onBlocksUpdated(updated);
      return updated;
    });
  }

  return (
    <>
      <section className="manual-schedule-section" aria-labelledby="manual-schedule-list-title">
      <div className="section-heading manual-schedule-heading">
        <div>
          <p className="eyebrow">MANUAL BLOCKS</p>
          <h2 id="manual-schedule-list-title">ช่วงเรียนที่เพิ่มเอง</h2>
        </div>
        <span className="manual-schedule-count">{blocks.length} ช่วง</span>
      </div>
      {isLoading ? (
        <p className="manual-schedule-empty">กำลังโหลดช่วงเรียน...</p>
      ) : blocks.length ? (
        <div className="manual-schedule-list">
          {blocks.map((block) => (
            <article className={`manual-schedule-row ${block.isCompleted ? 'manual-schedule-completed' : ''}`} key={block.id}>
              <label className="manual-schedule-check">
                <input type="checkbox" checked={block.isCompleted} onChange={(event) => void updateCompletion(block, event.target.checked)} />
                <span className="sr-only">ทำ {block.subjectLabel} เสร็จแล้ว</span>
              </label>
              <div className="manual-schedule-details">
                <strong>{block.subjectKind === 'activity' ? 'กิจกรรม: ' : ''}{block.subjectLabel}</strong>
                <span>{block.scheduledDate ? new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(block.scheduledDate + 'T00:00:00Z')) : dayNames[block.dayIndex]} · {block.startTime}–{getEndTime(block.startTime, block.durationMinutes)} · {blockTypeLabels[block.blockType]}</span>
              </div>
              <button className="manual-schedule-remove" type="button" onClick={() => void deleteBlock(block.id)} aria-label={`ลบช่วง ${block.subjectLabel}`}>ลบ</button>
            </article>
          ))}
        </div>
      ) : (
        <p className="manual-schedule-empty">ยังไม่มีช่วงที่เพิ่มเอง</p>
      )}
      </section>

      {isAddModalOpen && (
        <div
          className="activity-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeAddModal();
          }}
        >
          <div className="activity-modal manual-schedule-modal" role="dialog" aria-modal="true" aria-labelledby="manual-schedule-modal-title">
            <div className="activity-modal-header">
              <h2 id="manual-schedule-modal-title">{selectedDate ? `เพิ่มช่วงเรียนวันที่ ${new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(selectedDate + 'T00:00:00Z'))}` : 'เพิ่มช่วงเรียนเอง'}</h2>
              <button type="button" className="activity-modal-close" onClick={closeAddModal} aria-label="ปิด">×</button>
            </div>
            <p className="manual-schedule-hint">ระบบจะแจ้งเตือนเมื่อช่วงที่เพิ่มชนกับตารางอื่น</p>
            <form className="manual-schedule-form" onSubmit={addBlock}>
              <label>
                รายการ
                <select
                  value={subjectKey || subjects[0]?.key || ''}
                  onChange={(event) => {
                    const nextKey = event.target.value;
                    setSubjectKey(nextKey);
                    const nextSubject = subjects.find((subject) => subject.key === nextKey);
                    setWeight(nextSubject?.weight ?? 20);
                  }}
                  disabled={!subjects.length}
                >
                  {subjects.map((subject) => (
                    <option key={subject.key} value={subject.key}>{subject.kind === 'activity' ? 'กิจกรรม: ' : ''}{subject.label}</option>
                  ))}
                </select>
              </label>
              <label>
                วัน
                <select value={selectedDate ? getDayIndexForDate(selectedDate) : dayIndex} disabled={Boolean(selectedDate)} onChange={(event) => setDayIndex(Number(event.target.value))}>
                  {dayNames.map((day, index) => <option key={day} value={index}>{day}</option>)}
                </select>
              </label>
              <label>
                เริ่ม
                <input type="time" min="06:00" max="23:45" step="900" value={startTime} onChange={(event) => setStartTime(event.target.value)} />
              </label>
              <label>
                ระยะเวลา
                <select value={durationMinutes} onChange={(event) => setDurationMinutes(Number(event.target.value))}>
                  {[15, 30, 45, 60, 90, 120, 180, 240].map((minutes) => (
                    <option key={minutes} value={minutes}>{minutes < 60 ? `${minutes} นาที` : `${minutes / 60} ชม.`}</option>
                  ))}
                </select>
              </label>
              <label>
                ค่าน้ำหนัก (Weight)
                <select value={displayedWeight} onChange={(event) => setWeight(Number(event.target.value) as PriorityWeight)}>
                  {PRIORITY_WEIGHT_LEVELS.map((level) => <option key={level} value={level}>{level}%</option>)}
                </select>
              </label>
              <label>
                รูปแบบ
                <select value={blockType} onChange={(event) => setBlockType(event.target.value as BlockType)}>
                  {Object.entries(blockTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              {message && <p className="manual-schedule-message" role="status">{message}</p>}
              <div className="activity-modal-actions">
                <button type="button" onClick={cancelAddModal}>ยกเลิก</button>
                <button className="manual-schedule-add" type="submit" disabled={isSaving || !subjects.length}>
                  {isSaving ? 'กำลังเพิ่ม...' : 'เพิ่มช่วง'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}