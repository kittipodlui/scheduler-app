import AuthForm from '@/app/components/auth-form';

const errors: Record<string, string> = {
  invalid_form: 'ข้อมูลสมัครสมาชิกไม่ถูกต้อง',
  invalid_username: 'Username ใช้ a-z, 0-9 หรือ _ ความยาว 3–32 ตัวอักษร',
  invalid_password: 'Password ต้องมีความยาว 8–128 ตัวอักษร',
  password_mismatch: 'ยืนยัน password ไม่ตรงกัน',
  username_exists: 'Username นี้ถูกใช้งานแล้ว',
  server_error: 'สมัครสมาชิกไม่สำเร็จ ตรวจสอบการเชื่อมต่อฐานข้อมูล',
};

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return <AuthForm mode="register" initialError={error ? errors[error] : undefined} />;
}