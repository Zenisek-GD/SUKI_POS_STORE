import { one } from '../models/database.js';
import { assert } from '../utils.js';

const pad = (value) => String(value).padStart(2, '0');
const stamp = (date) => date.toISOString().slice(0, 23).replace('T', ' ');
const localDate = (value) => new Date(`${value.replace(' ', 'T')}Z`);
const calendarDate = (year, month = 1, day = 1) => new Date(Date.UTC(year, month - 1, day));

export function percentageChange(current, previous, available = true) {
  if (!available) return { percent: null, direction: 'unavailable' };
  const direction = current > previous ? 'increase' : current < previous ? 'decrease' : 'unchanged';
  if (current === previous) return { percent: 0, direction };
  if (previous === 0) return { percent: null, direction };
  return {
    percent: Math.round(((current - previous) / Math.abs(previous)) * 10000) / 100,
    direction,
  };
}

// These Date objects represent wall-clock calendar values, not UTC instants. PostgreSQL
// converts each boundary using the store timezone, so DST days need not be 24 hours long.
function previousCutoff(level, start, end, now) {
  let cutoff;
  if (level === 'years') {
    const year = start.getUTCFullYear(),
      month = now.getUTCMonth();
    const day = Math.min(now.getUTCDate(), new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
    cutoff = new Date(
      Date.UTC(
        year,
        month,
        day,
        now.getUTCHours(),
        now.getUTCMinutes(),
        now.getUTCSeconds(),
        now.getUTCMilliseconds(),
      ),
    );
  } else if (level === 'months') {
    const days = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0),
    ).getUTCDate();
    if (now.getUTCDate() > days) return end;
    cutoff = new Date(
      Date.UTC(
        start.getUTCFullYear(),
        start.getUTCMonth(),
        now.getUTCDate(),
        now.getUTCHours(),
        now.getUTCMinutes(),
        now.getUTCSeconds(),
        now.getUTCMilliseconds(),
      ),
    );
  } else {
    cutoff = new Date(start);
    cutoff.setUTCHours(
      now.getUTCHours(),
      now.getUTCMinutes(),
      now.getUTCSeconds(),
      now.getUTCMilliseconds(),
    );
  }
  return cutoff > end ? end : cutoff;
}

function period(level, year, month, day, now, history, comparisonMode) {
  const start = calendarDate(year, month, day),
    next = new Date(start),
    previous = new Date(start);
  if (level === 'years') {
    next.setUTCFullYear(year + 1);
    previous.setUTCFullYear(year - 1);
  } else if (level === 'months') {
    next.setUTCMonth(start.getUTCMonth() + 1);
    previous.setUTCMonth(start.getUTCMonth() - 1);
  } else {
    next.setUTCDate(start.getUTCDate() + 1);
    previous.setUTCDate(start.getUTCDate() - 1);
  }
  const future = start >= now,
    inProgress = !future && next > now;
  const end = inProgress ? now : next;
  const equivalentElapsed = inProgress && comparisonMode === 'elapsed';
  const previousEnd = equivalentElapsed ? previousCutoff(level, previous, start, now) : start;
  // If the preceding calendar period is shorter, trim only the percentage's
  // current window too. Displayed totals still include all activity to date.
  let comparisonEnd = end;
  if (equivalentElapsed && level === 'months') {
    const previousDays = Math.round((start - previous) / 86400000);
    if (now.getUTCDate() > previousDays) {
      comparisonEnd = new Date(start);
      comparisonEnd.setUTCDate(previousDays + 1);
    }
  } else if (
    equivalentElapsed &&
    level === 'years' &&
    now.getUTCMonth() === 1 &&
    now.getUTCDate() === 29 &&
    previousEnd.getUTCDate() === 28
  ) {
    comparisonEnd = new Date(now);
    comparisonEnd.setUTCDate(28);
  }
  const availability = future
    ? 'future'
    : end <= history
      ? 'missing'
      : start < history
        ? 'partial'
        : 'complete';
  const key =
    level === 'years'
      ? String(year)
      : level === 'months'
        ? `${year}-${pad(month)}`
        : `${year}-${pad(month)}-${pad(day)}`;
  const previousKey =
    level === 'years'
      ? String(previous.getUTCFullYear())
      : stamp(previous).slice(0, level === 'months' ? 7 : 10);
  return {
    key,
    year,
    month: level === 'years' ? null : month,
    day: level === 'days' ? day : null,
    label:
      level === 'years'
        ? String(year)
        : new Intl.DateTimeFormat('en', {
            timeZone: 'UTC',
            month: level === 'months' ? 'long' : 'short',
            ...(level === 'days' ? { day: 'numeric', weekday: 'short' } : {}),
          }).format(start),
    availability,
    in_progress: inProgress,
    equivalent_elapsed: equivalentElapsed,
    current_start: stamp(start),
    current_end: stamp(end),
    comparison_end: stamp(comparisonEnd),
    previous_start: stamp(previous),
    previous_end: stamp(previousEnd),
    previous_key: previousKey,
    comparison_available: availability === 'complete' && previous >= history && !future,
  };
}

export async function salesOverview(db, storeId, query = {}, asOf = new Date()) {
  const year = query.year == null ? null : Number(query.year),
    month = query.month == null ? null : Number(query.month),
    comparisonMode = query.comparison ?? 'full';
  assert(
    comparisonMode === 'full' || comparisonMode === 'elapsed',
    422,
    'Choose full or elapsed for the comparison basis.',
  );
  assert(
    year === null || (Number.isInteger(year) && year >= 1900 && year <= 9998),
    422,
    'Choose a valid reporting year.',
  );
  assert(
    month === null || (year !== null && Number.isInteger(month) && month >= 1 && month <= 12),
    422,
    'Choose a year and a month from 1 to 12.',
  );
  const settings = await one(
    db,
    `SELECT ss.timezone,s.created_at AS reporting_started_at,
    to_char(s.created_at AT TIME ZONE ss.timezone,'YYYY-MM-DD HH24:MI:SS.MS') AS history_local,
    to_char($2::timestamptz AT TIME ZONE ss.timezone,'YYYY-MM-DD HH24:MI:SS.MS') AS now_local
    FROM stores s JOIN store_settings ss ON ss.store_id=s.id WHERE s.id=$1`,
    [storeId, asOf.toISOString()],
  );
  assert(settings, 404, 'Store settings were not found.');
  const now = localDate(settings.now_local),
    history = localDate(settings.history_local);
  const level = month !== null ? 'days' : year !== null ? 'months' : 'years';
  const periods = [];
  if (level === 'years') {
    // Include the immediately preceding unavailable year, so unknown history is visible.
    for (let value = history.getUTCFullYear() - 1; value <= now.getUTCFullYear(); value++)
      periods.push(period(level, value, 1, 1, now, history, comparisonMode));
  } else if (level === 'months') {
    for (let value = 1; value <= 12; value++)
      periods.push(period(level, year, value, 1, now, history, comparisonMode));
  } else {
    const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
    for (let value = 1; value <= count; value++)
      periods.push(period(level, year, month, value, now, history, comparisonMode));
  }
  const amounts = (
    await db.query(
      `WITH periods AS (
      SELECT key, current_start::timestamp AT TIME ZONE $3 AS current_start,
        CASE WHEN in_progress THEN $4::timestamptz ELSE current_end::timestamp AT TIME ZONE $3 END AS current_end,
        CASE WHEN in_progress AND comparison_end=current_end THEN $4::timestamptz ELSE comparison_end::timestamp AT TIME ZONE $3 END AS comparison_end,
        previous_start::timestamp AT TIME ZONE $3 AS previous_start, previous_end::timestamp AT TIME ZONE $3 AS previous_end
      FROM jsonb_to_recordset($2::jsonb) AS p(key text,current_start text,current_end text,comparison_end text,previous_start text,previous_end text,in_progress boolean)
    ), windows AS (
      SELECT key,'current' AS kind,current_start AS start_at,current_end AS end_at FROM periods
      UNION ALL SELECT key,'comparison',current_start,comparison_end FROM periods
      UNION ALL SELECT key,'previous',previous_start,previous_end FROM periods
    )
    SELECT w.key,w.kind,COALESCE(s.gross_sales,0)::bigint AS gross_sales,COALESCE(s.discounts,0)::bigint AS discounts,
      (COALESCE(s.tax,0)-COALESCE(r.tax,0))::bigint AS tax,COALESCE(r.refunds,0)::bigint AS refunds,
      (COALESCE(s.collected,0)-COALESCE(r.refunds,0))::bigint AS net_sales,COALESCE(s.transactions,0)::int AS transactions
    FROM windows w
    LEFT JOIN LATERAL (
      SELECT SUM(subtotal) AS gross_sales,SUM(discount) AS discounts,SUM(tax) AS tax,SUM(total) AS collected,COUNT(*) AS transactions
      FROM sales WHERE store_id=$1 AND status='completed' AND created_at>=w.start_at AND created_at<w.end_at
    ) s ON true
    LEFT JOIN LATERAL (
      SELECT SUM(r.total) AS refunds,SUM(r.tax) AS tax FROM sales_returns r
      JOIN sales s ON s.store_id=r.store_id AND s.id=r.sale_id AND s.status='completed'
      WHERE r.store_id=$1 AND r.created_at>=w.start_at AND r.created_at<w.end_at
    ) r ON true`,
      [storeId, JSON.stringify(periods), settings.timezone, asOf.toISOString()],
    )
  ).rows;
  const rows = periods.map((p) => {
    const current = amounts.find((a) => a.key === p.key && a.kind === 'current'),
      previous = amounts.find((a) => a.key === p.key && a.kind === 'previous'),
      comparison = amounts.find((a) => a.key === p.key && a.kind === 'comparison');
    const known = p.availability === 'complete' || p.availability === 'partial';
    const values = Object.fromEntries(
      ['gross_sales', 'discounts', 'tax', 'refunds', 'net_sales', 'transactions'].map((key) => [
        key,
        known ? Number(current[key]) : null,
      ]),
    );
    const change = percentageChange(
      Number(comparison.net_sales),
      Number(previous.net_sales),
      p.comparison_available,
    );
    let reason = null;
    if (p.availability === 'future') reason = 'This period has not started.';
    else if (p.availability === 'missing') reason = 'This period is before recorded store history.';
    else if (p.availability === 'partial')
      reason = 'Only part of this period has recorded history.';
    else if (!p.comparison_available)
      reason = 'The previous period does not have complete recorded history.';
    else if (Number(previous.net_sales) === 0 && change.percent === null)
      reason =
        'Previous period net sales are confirmed zero, so a percentage cannot be calculated.';
    return {
      key: p.key,
      label: p.label,
      year: p.year,
      month: p.month,
      day: p.day,
      availability: p.availability,
      in_progress: p.in_progress,
      ...values,
      change_percent: change.percent,
      direction: change.direction,
      comparison: {
        period: p.previous_key,
        current_net_sales: p.comparison_available ? Number(comparison.net_sales) : null,
        previous_net_sales: p.comparison_available ? Number(previous.net_sales) : null,
        reason,
        current_from: p.current_start,
        current_to: p.comparison_end,
        previous_from: p.previous_start,
        previous_to: p.previous_end,
        equivalent_elapsed: p.equivalent_elapsed,
        capped: p.comparison_end !== p.current_end,
      },
    };
  });
  if (level === 'years') rows.reverse();
  return {
    level,
    year,
    month,
    timezone: settings.timezone,
    comparison_mode: comparisonMode,
    reporting_started_at: settings.reporting_started_at,
    as_of: asOf.toISOString(),
    basis:
      'Gross sales are recorded item prices before discounts; prices may include tax. Net sales are completed checkout totals after discounts, including collected tax, less refunds processed in this period. Refunds follow their processing date, not the original sale date. Voided transactions are excluded.',
    comparison_basis:
      (comparisonMode === 'full'
        ? 'Each period compares its net sales with the full preceding calendar year, month, or day. In-progress periods use current sales to date against the full previous period.'
        : 'In-progress changes compare the same local calendar cutoff in both periods. When the preceding month is shorter, both comparison windows use its day count; February 29 uses February 28 in both years if needed. Displayed sales totals always include all activity to date.') +
      ' Percentage change is the difference divided by the absolute previous net sales. Equal totals show 0%; a zero baseline with different totals has a direction but no percentage.',
    rows,
  };
}
