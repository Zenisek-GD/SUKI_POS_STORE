let csrf = '';
export const setCsrf = (value) => {
  csrf = value;
};
export async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    ...options,
    headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf, ...options.headers },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const data = await response
    .json()
    .catch(() => ({ error: 'The server returned an unexpected response.' }));
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/auth/'))
      window.dispatchEvent(new Event('suki:expired'));
    const error = new Error(data.error || 'Request failed.');
    error.status = response.status;
    throw error;
  }
  return data;
}
export function downloadCSV(name, rows) {
  if (!rows.length) return;
  const fields = Object.keys(rows[0]);
  const escape = (value) => {
    let s = value == null ? '' : String(value);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replaceAll('"', '""')}"`;
  };
  const csv =
    '\uFEFF' +
    [fields, ...rows.map((r) => fields.map((f) => r[f]))]
      .map((row) => row.map(escape).join(','))
      .join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const cash = (amount, currency = 'PHP') =>
  new Intl.NumberFormat('en-PH', { style: 'currency', currency }).format(Number(amount || 0) / 100);
export const localDate = (value = new Date(), timezone = 'Asia/Manila') =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
export const dateTime = (value, timezone = 'Asia/Manila') =>
  new Intl.DateTimeFormat('en-PH', {
    timeZone: timezone,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
export function dateRange(days = 7, timezone = 'Asia/Manila') {
  const now = new Date();
  return {
    from: localDate(new Date(now.getTime() - (days - 1) * 86400000), timezone),
    to: localDate(now, timezone),
  };
}
export const titleCase = (s) => s.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
