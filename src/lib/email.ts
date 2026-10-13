export function normalizeGmailAddress(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254) return null;

  const separatorIndex = email.lastIndexOf('@');
  if (separatorIndex < 1 || email.slice(separatorIndex + 1) !== 'gmail.com') return null;

  const localPart = email.slice(0, separatorIndex);
  if (!/^[a-z0-9](?:[a-z0-9._+-]*[a-z0-9])?$/.test(localPart) || localPart.length > 64) return null;
  if (localPart.includes('..')) return null;

  const accountName = localPart.split('+', 1)[0].replaceAll('.', '');
  if (!accountName || accountName.length > 30) return null;

  return `${accountName}@gmail.com`;
}