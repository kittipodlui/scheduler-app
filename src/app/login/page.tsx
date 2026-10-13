import AuthForm from '@/app/components/auth-form';

const errors: Record<string, string> = {
  invalid_form: 'ข้อมูลเข้าสู่ระบบไม่ถูกต้อง',
  missing_credentials: 'กรอก username และ password ให้ครบ',
  invalid_credentials: 'Username หรือ password ไม่ถูกต้อง',
  server_error: 'เข้าสู่ระบบไม่สำเร็จ ตรวจสอบการเชื่อมต่อฐานข้อมูล',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return <AuthForm mode="login" initialError={error ? errors[error] : undefined} />;
}