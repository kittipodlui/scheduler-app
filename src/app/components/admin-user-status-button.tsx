'use client';

import { useState } from 'react';

type Props = { userId: number; active: boolean; onChanged?: () => void };

export default function AdminUserStatusButton({ userId, active, onChanged }: Props) {
  const [busy, setBusy] = useState(false);
  async function toggle() {
    setBusy(true);
    try {
      const response = await fetch('/api/admin/users/status', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, active: !active }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || 'เปลี่ยนสถานะไม่สำเร็จ');
      }
      onChanged?.();
      window.location.reload();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'เปลี่ยนสถานะไม่สำเร็จ');
    } finally { setBusy(false); }
  }
  return <button type="button" onClick={toggle} disabled={busy}>{busy ? 'กำลังดำเนินการ...' : active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}</button>;
}
