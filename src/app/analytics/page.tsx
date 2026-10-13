import StudyAnalytics from '@/app/components/study-analytics';
import { requireAuthenticatedUser } from '@/lib/auth-page';

export const dynamic = 'force-dynamic';

export default async function AnalyticsPage() {
  await requireAuthenticatedUser();
  return <StudyAnalytics />;
}