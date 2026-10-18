export function redact(value: string): string {
  const key = process.env.DEEPSEEK_API_KEY;
  const withoutEnvKey = key ? value.replaceAll(key, '[REDACTED]') : value;
  return withoutEnvKey.replace(/sk-[A-Za-z0-9_-]{20,}/g, '[REDACTED]');
}
