'use client';

import { useEffect, useState } from 'react';
import type { AnalyticsData } from '@/lib/analytics-types';

export function useAnalyticsData(weekStartDate: string) {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadAnalytics() {
      setIsLoading(true);
      setError('');
      try {
        const params = new URLSearchParams({ weekStartDate });
        const response = await fetch('/api/analytics?' + params.toString(), { cache: 'no-store' });
        if (response.status === 401) {
          window.location.replace('/login');
          return;
        }
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'โหลด analytics ไม่สำเร็จ');
        if (!cancelled) setData(result as AnalyticsData);
      } catch (requestError: unknown) {
        if (!cancelled) {
          setError(requestError instanceof Error ? requestError.message : 'โหลด analytics ไม่สำเร็จ');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void loadAnalytics();
    const handleFocus = () => void loadAnalytics();
    window.addEventListener('focus', handleFocus);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', handleFocus);
    };
  }, [weekStartDate]);

  return { data, error, isLoading };
}