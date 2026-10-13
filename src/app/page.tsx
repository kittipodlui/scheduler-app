import { redirect } from 'next/navigation';
import HomeDashboard from '@/app/components/home-dashboard';
import { requireAuthenticatedUser } from '@/lib/auth-page';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const user = await requireAuthenticatedUser();
  if (user.role === 'admin') redirect('/admin');
  return <HomeDashboard username={user.username} />;
}