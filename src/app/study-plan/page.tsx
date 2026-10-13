import StudyPlanner from '@/app/components/study-planner';
import { requireAuthenticatedUser } from '@/lib/auth-page';

export const dynamic = 'force-dynamic';

export default async function StudyPlanPage({ searchParams }: { searchParams: Promise<{ openActivity?: string }> }) {
  await requireAuthenticatedUser();
  const params = await searchParams;
  return <StudyPlanner openActivity={params.openActivity === '1'} />;
}