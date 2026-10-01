import { useState } from 'react';
import { ArrowDown, ArrowUp, ArrowLeft, ChevronRight, Minus, RefreshCw } from 'lucide-react';
import { useResource } from '../lib/useResource';
import { useStore } from '../lib/storeContext';
import { cash, dateTime } from '../lib/api';
import { Button, Loading, ErrorState } from './ui';
import './SalesOverview.css';

function Change({ row, currency }) {
  const Icon =
    row.direction === 'increase' ? ArrowUp : row.direction === 'decrease' ? ArrowDown : Minus;
  const previous = row.comparison.previous_net_sales;
  const explanation =
    row.comparison.reason ||
    `${cash(row.comparison.current_net_sales, currency)} compared with ${row.comparison.period}: ${cash(previous, currency)}${row.comparison.equivalent_elapsed ? ', same elapsed calendar period' : ''}.`;
  const label = {
    increase: 'Increased',
    decrease: 'Decreased',
    unchanged: 'No change',
    unavailable: 'No comparison',
  }[row.direction];
  return (
    <>
      <span className={`overview-change ${row.direction}`} title={explanation}>
        {row.direction !== 'unavailable' && <Icon size={18} strokeWidth={2.5} aria-hidden="true" />}
        <span>
          {row.change_percent === null
            ? previous === 0 && row.direction !== 'unavailable'
              ? 'From zero'
              : 'N/A'
            : `${row.change_percent > 0 ? '+' : ''}${row.change_percent.toFixed(2)}%`}
        </span>
      </span>
      <small className="overview-change-label">{label}</small>
    </>
  );
}

export default function SalesOverview() {
  const { data } = useStore();
  const [selection, setSelection] = useState({ year: null, month: null });
  const [breakdown, setBreakdown] = useState(false);
  const query = new URLSearchParams();
  query.set('comparison', 'full');
  if (selection.year !== null) query.set('year', selection.year);
  if (selection.month !== null) query.set('month', selection.month);
  const resource = useResource(`/reports/overview?${query}`);
  const report = resource.data,
    currency = data.settings.currency;
  const level = selection.month !== null ? 'Day' : selection.year !== null ? 'Month' : 'Year';
  const monthName =
    selection.month === null
      ? ''
      : new Intl.DateTimeFormat('en', { month: 'long', timeZone: 'UTC' }).format(
          new Date(Date.UTC(selection.year, selection.month - 1, 1)),
        );
  const back = () =>
    setSelection(
      selection.month !== null
        ? { year: selection.year, month: null }
        : { year: null, month: null },
    );
  return (
    <section className="panel sales-calendar" aria-label="Calendar sales overview">
      <div className="panel-header">
        <div>
          <h2>Sales by calendar period</h2>
        </div>
        <Button variant="secondary" onClick={resource.reload} aria-label="Refresh calendar sales">
          <RefreshCw size={16} />
          Refresh
        </Button>
      </div>
      <div className="overview-tools">
        <span>Compared with the previous {level.toLowerCase()}.</span>
        <label className="overview-breakdown-toggle">
          <input
            type="checkbox"
            checked={breakdown}
            onChange={(event) => setBreakdown(event.target.checked)}
          />
          Show sales breakdown
        </label>
      </div>
      <div className="overview-navigation">
        <nav aria-label="Sales overview breadcrumbs">
          <button
            type="button"
            onClick={() => setSelection({ year: null, month: null })}
            aria-current={selection.year === null ? 'page' : undefined}
          >
            All years
          </button>
          {selection.year !== null && (
            <>
              <ChevronRight size={14} />
              <button
                type="button"
                onClick={() => setSelection({ year: selection.year, month: null })}
                aria-current={selection.month === null ? 'page' : undefined}
              >
                {selection.year}
              </button>
            </>
          )}
          {selection.month !== null && (
            <>
              <ChevronRight size={14} />
              <span aria-current="page">{monthName}</span>
            </>
          )}
        </nav>
        {selection.year !== null && (
          <Button variant="ghost" onClick={back}>
            <ArrowLeft size={15} />
            Back
          </Button>
        )}
      </div>
      {resource.loading ? (
        <Loading />
      ) : resource.error ? (
        <ErrorState message={resource.error} retry={resource.reload} />
      ) : (
        report && (
          <>
            <div
              className={`table-scroll overview-table ${breakdown ? 'with-breakdown' : 'comparison-only'}`}
              tabIndex={0}
              role="region"
              aria-label={`${level} sales records`}
            >
              <table>
                <thead>
                  <tr>
                    <th scope="col">{level}</th>
                    <th scope="col">Net sales</th>
                    <th scope="col">Change</th>
                    {breakdown && (
                      <>
                        <th scope="col">Gross sales</th>
                        <th scope="col">Discounts</th>
                        <th scope="col">Returns / refunds</th>
                        <th scope="col">Data coverage</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((row) => {
                    const unavailable = ['missing', 'future'].includes(row.availability);
                    return (
                      <tr key={row.key} className={unavailable ? 'overview-unavailable' : ''}>
                        <td className="overview-period-cell">
                          {level !== 'Day' ? (
                            <button
                              className="overview-period"
                              type="button"
                              onClick={() => setSelection({ year: row.year, month: row.month })}
                              aria-label={`View ${level === 'Year' ? 'months' : 'days'} for ${row.key}`}
                            >
                              <span className="overview-full-period">{row.label}</span>
                              <span className="overview-short-period" aria-hidden="true">
                                {level === 'Month' ? row.label.slice(0, 3) : row.label}
                              </span>
                              <ChevronRight size={14} />
                            </button>
                          ) : (
                            <strong>{row.label}</strong>
                          )}
                          {row.in_progress && (
                            <small className="overview-progress">In progress</small>
                          )}
                        </td>
                        <td className="overview-net-cell text-strong">
                          {row.net_sales === null ? '—' : cash(row.net_sales, currency)}
                        </td>
                        <td className="overview-change-cell">
                          <Change row={row} currency={currency} />
                          <small className="overview-comparison">
                            vs {row.comparison.period}
                            {row.comparison.previous_net_sales !== null && (
                              <> · {cash(row.comparison.previous_net_sales, currency)}</>
                            )}
                            {row.comparison.equivalent_elapsed ? ' · elapsed' : ''}
                          </small>
                          {!breakdown && row.direction === 'unavailable' && (
                            <small className="overview-reason" title={row.comparison.reason}>
                              {row.availability === 'future'
                                ? 'Not started'
                                : row.availability === 'partial'
                                  ? 'Partial history'
                                  : 'Insufficient history'}
                            </small>
                          )}
                          {row.comparison.capped && (
                            <small className="overview-reason">
                              Comparison ends {row.comparison.current_to.slice(0, 16)} to match the
                              shorter period.
                            </small>
                          )}
                        </td>
                        {breakdown && (
                          <>
                            {['gross_sales', 'discounts', 'refunds'].map((key) => (
                              <td key={key}>
                                {row[key] === null ? '—' : cash(row[key], currency)}
                              </td>
                            ))}
                            <td>
                              <span className={`overview-coverage ${row.availability}`}>
                                {row.availability === 'future'
                                  ? 'Not started'
                                  : row.availability === 'missing'
                                    ? 'No recorded history'
                                    : row.availability === 'partial'
                                      ? 'Partial history'
                                      : row.transactions === 0 && row.refunds === 0
                                        ? 'Confirmed zero sales'
                                        : 'Recorded'}
                              </span>
                              {row.comparison.reason && (
                                <small className="overview-reason">{row.comparison.reason}</small>
                              )}
                            </td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <details className="overview-notes">
              <summary>How sales are calculated</summary>
              <p>{report.basis}</p>
              <p>
                {report.comparison_basis} Percentage change = (current net sales − previous net
                sales) ÷ absolute previous net sales × 100. Equal totals display — 0.00%, including
                two confirmed zero periods. A change from zero displays an arrow and “From zero”
                because a percentage cannot be calculated. Unavailable history displays N/A.
              </p>
              <p>
                Timezone: <strong>{report.timezone}</strong> · Recorded history begins{' '}
                {dateTime(report.reporting_started_at, report.timezone)}. Partial history cannot
                provide a complete comparison.
              </p>
            </details>
          </>
        )
      )}
    </section>
  );
}
