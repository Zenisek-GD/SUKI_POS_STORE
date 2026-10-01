import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowUpRight,
  ArrowRight,
  ShoppingBag,
  ReceiptText,
  TrendingUp,
  TriangleAlert,
  CalendarDays,
  Download,
  Package,
  Wallet,
} from 'lucide-react';
import { useStore } from '../lib/storeContext';
import { useResource } from '../lib/useResource';
import SalesOverview from '../components/SalesOverview';
import './Insights.css';
import { cash, dateRange, localDate, downloadCSV, dateTime } from '../lib/api';
import {
  PageHeader,
  Button,
  Badge,
  ProductAvatar,
  Loading,
  ErrorState,
  Empty,
} from '../components/ui';
export function Metric({ label, value, detail, icon: Icon, tone = '' }) {
  return (
    <div className={`metric-card ${tone}`}>
      <div>
        <span>{label}</span>
        <span className="metric-icon">
          <Icon size={20} />
        </span>
      </div>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}
export function SalesChart({ daily, from, to, currency }) {
  const days = [];
  for (
    let date = new Date(`${from}T12:00:00Z`);
    date <= new Date(`${to}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + 1)
  ) {
    const key = date.toISOString().slice(0, 10);
    days.push({ date: key, total: Number(daily.find((d) => d.date === key)?.total || 0) });
  }
  if (!days.length) return <Empty title="No sales in this period" />;
  const max = Math.max(...days.map((d) => d.total), 10000) * 1.2,
    min = Math.min(...days.map((d) => d.total), 0) * 1.2,
    w = 640,
    h = 178,
    x = (i) => 50 + (i / Math.max(days.length - 1, 1)) * w,
    y = (v) => 22 + h - ((v - min) / (max - min)) * h;
  let path = `M ${x(0)} ${y(days[0].total)}`;
  for (let i = 1; i < days.length; i++)
    path += ` C ${(x(i - 1) + x(i)) / 2} ${y(days[i - 1].total)} ${(x(i - 1) + x(i)) / 2} ${y(days[i].total)} ${x(i)} ${y(days[i].total)}`;
  const indexes = [
    ...new Set([
      0,
      Math.floor((days.length - 1) / 4),
      Math.floor((days.length - 1) / 2),
      Math.floor(((days.length - 1) * 3) / 4),
      days.length - 1,
    ]),
  ];
  return (
    <div className="sales-chart">
      <svg viewBox="0 0 720 248" role="img" aria-label={`Daily sales from ${from} to ${to}`}>
        <defs>
          <linearGradient id="sales-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#94b9a2" stopOpacity=".25" />
            <stop offset="100%" stopColor="#94b9a2" stopOpacity=".01" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3].map((i) => (
          <g key={i}>
            <line
              x1="50"
              x2="695"
              y1={y(min + ((max - min) * i) / 3)}
              y2={y(min + ((max - min) * i) / 3)}
              stroke="#e7ebe7"
              strokeDasharray="4 5"
            />
            <text x="0" y={y(min + ((max - min) * i) / 3) + 4} fill="#939992" fontSize="10">
              {new Intl.NumberFormat('en', {
                notation: 'compact',
                maximumFractionDigits: 1,
              }).format((min + ((max - min) * i) / 3) / 100)}
            </text>
          </g>
        ))}
        <path
          d={`${path} L ${x(days.length - 1)} ${y(0)} L ${x(0)} ${y(0)} Z`}
          fill="url(#sales-fill)"
        />
        <path d={path} fill="none" stroke="#39765a" strokeWidth="2.8" />
        {days.map((d, i) => (
          <circle
            key={d.date}
            cx={x(i)}
            cy={y(d.total)}
            r={days.length < 10 ? 4 : 2}
            fill="#fff"
            stroke="#39765a"
            strokeWidth="2"
          >
            <title>
              {d.date}: {cash(d.total, currency)}
            </title>
          </circle>
        ))}
        {indexes.map((i) => (
          <text key={i} x={x(i)} y="230" textAnchor="middle" fill="#8b938d" fontSize="11">
            {new Date(`${days[i].date}T12:00:00`).toLocaleDateString('en', {
              month: 'short',
              day: 'numeric',
            })}
          </text>
        ))}
      </svg>
    </div>
  );
}
export function CategoryChart({ rows, currency }) {
  const hasNegative = rows.some((r) => Number(r.total) < 0);
  rows = rows.filter((r) => Number(r.total) > 0);
  const sum = rows.reduce((s, r) => s + Number(r.total || 0), 0),
    colors = ['#376e51', '#8fac83', '#bccda2', '#e2c885', '#cf9f83', '#9da7b5'];
  return (
    <>
      <div className="category-donut">
        <svg viewBox="0 0 140 140" role="img" aria-label="Sales by category">
          <circle cx="70" cy="70" r="52" fill="none" stroke="#edf0e9" strokeWidth="18" />
          {rows.map((r, i) => {
            const length = sum ? (Number(r.total) / sum) * 326.73 : 0;
            const circle = (
              <circle
                key={r.name}
                cx="70"
                cy="70"
                r="52"
                fill="none"
                stroke={colors[i % colors.length]}
                strokeWidth="18"
                strokeDasharray={`${Math.max(length - 2, 0)} ${326.73 - length + 2}`}
                strokeDashoffset={
                  -rows
                    .slice(0, i)
                    .reduce((s, r) => s + (sum ? (Number(r.total) / sum) * 326.73 : 0), 0)
                }
                transform="rotate(-90 70 70)"
              >
                <title>
                  {r.name}: {cash(r.total, currency)}
                </title>
              </circle>
            );
            return circle;
          })}
          <text x="70" y="66" textAnchor="middle" fontSize="10" fill="#949b94">
            CATEGORIES
          </text>
          <text x="70" y="87" textAnchor="middle" fontSize="25" fontWeight="600" fill="#273c2e">
            {rows.length}
          </text>
        </svg>
      </div>
      <div className="category-legend">
        {rows.slice(0, 6).map((r, i) => (
          <div key={r.name}>
            <span>
              <i style={{ background: colors[i % colors.length] }} />
              {r.name}
            </span>
            <strong>{sum ? Math.round((Number(r.total) / sum) * 100) : 0}%</strong>
          </div>
        ))}
        {!rows.length && <p className="muted">Your category mix appears after your first sale.</p>}
        {hasNegative && (
          <p className="muted">
            Categories with net refunds are excluded from this chart. See the category report for
            all totals.
          </p>
        )}
      </div>
    </>
  );
}
export default function Dashboard() {
  const { data, user } = useStore(),
    [days, setDays] = useState(7),
    range = dateRange(days, data.settings.timezone),
    today = localDate(new Date(), data.settings.timezone);
  const report = useResource(`/reports?from=${range.from}&to=${range.to}`),
    todayReport = useResource(`/reports?from=${today}&to=${today}`),
    sales = useResource('/sales');
  const m = (v) => cash(v, data.settings.currency),
    stats = todayReport.data?.summary;
  const low = data.products
    .filter((p) => p.active && p.stock <= (p.min_stock ?? data.settings.low_stock_threshold))
    .sort((a, b) => a.stock - b.stock);
  return (
    <div className="insights-page dashboard-page">
      <PageHeader
        eyebrow={`HELLO, ${user.name.split(' ')[0].toUpperCase()} ☀`}
        title="A good day for business."
        description="Here's what's happening at your store today."
      >
        <Button
          variant="secondary"
          onClick={() =>
            downloadCSV(`sales-${range.from}-${range.to}`, report.data?.transactions || [])
          }
          disabled={!report.data?.transactions?.length}
        >
          <Download size={16} />
          Export report
        </Button>
        <Link className="btn" to="/pos">
          <ShoppingBag size={17} />
          Open register
          <ArrowUpRight size={15} />
        </Link>
      </PageHeader>
      <div className="date-strip">
        <span>
          <CalendarDays size={15} />
          {new Intl.DateTimeFormat('en-PH', {
            timeZone: data.settings.timezone,
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            year: 'numeric',
          }).format(new Date())}
        </span>
      </div>
      {todayReport.error ? (
        <ErrorState message={todayReport.error} retry={todayReport.reload} />
      ) : (
        <div className="metrics-grid">
          <Metric
            label="Today's net sales"
            value={stats ? m(stats.sales) : '…'}
            detail={stats ? `${m(stats.refunds)} refunded today` : 'After refunds processed today'}
            icon={ShoppingBag}
            tone="featured"
          />
          <Metric
            label="Transactions"
            value={stats?.transactions ?? '…'}
            detail={
              stats?.transactions
                ? `${m(stats.collected_sales / stats.transactions)} average checkout`
                : 'Ready for your next customer'
            }
            icon={ReceiptText}
          />
          <Metric
            label="Estimated profit"
            value={stats ? m(stats.profit) : '…'}
            detail="After refunds, cost, tax, and expenses"
            icon={TrendingUp}
          />
          <Metric
            label="Stock alerts"
            value={low.length}
            detail={`${low.filter((p) => !p.stock).length} out of stock · ${data.products.filter((p) => p.active).length} active products`}
            icon={TriangleAlert}
            tone="amber"
          />
        </div>
      )}
      <div className="dashboard-charts">
        <section className="panel sales-panel">
          <div className="panel-header">
            <div>
              <h2>Sales overview</h2>
            </div>
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              aria-label="Sales period"
            >
              <option value="1">Today</option>
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
            </select>
          </div>
          {report.loading ? (
            <Loading />
          ) : report.error ? (
            <ErrorState message={report.error} retry={report.reload} />
          ) : (
            <>
              <div className="sales-headline">
                <strong>{m(report.data.summary.sales)}</strong>
                <span>
                  <i />
                  Net sales after refunds
                </span>
              </div>
              <SalesChart daily={report.data.daily} {...range} currency={data.settings.currency} />
              <div className="chart-footnote">
                <span>
                  <Wallet size={14} />
                  Expenses <b>{m(report.data.summary.expenses)}</b>
                </span>
                <span>
                  Gross sales <b>{m(report.data.summary.gross_sales)}</b>
                </span>
              </div>
            </>
          )}
        </section>
        <section className="panel category-panel">
          <div className="panel-header">
            <div>
              <h2>Sales by category</h2>
            </div>
            <span className="subtle-icon">
              <Package size={18} />
            </span>
          </div>
          {report.data ? (
            <CategoryChart rows={report.data.categories} currency={data.settings.currency} />
          ) : (
            <Loading />
          )}
        </section>
      </div>
      <div className="dashboard-bottom">
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Recent transactions</h2>
            </div>
            <Link className="text-link" to="/sales">
              View all
              <ArrowRight size={15} />
            </Link>
          </div>
          {sales.loading ? (
            <Loading />
          ) : sales.error ? (
            <ErrorState message={sales.error} retry={sales.reload} />
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Transaction</th>
                    <th>Customer</th>
                    <th>Payment</th>
                    <th>Amount</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {sales.data?.slice(0, 5).map((s) => (
                    <tr key={s.id}>
                      <td>
                        <Link className="transaction-number" to={`/sales?id=${s.id}`}>
                          {s.number.slice(-8)}
                        </Link>
                        <small className="table-secondary">
                          {dateTime(s.created_at, data.settings.timezone)}
                        </small>
                      </td>
                      <td>{s.customer || 'Walk-in customer'}</td>
                      <td>
                        <span className="payment-label">{s.payment_method}</span>
                      </td>
                      <td className="text-strong">{m(s.total)}</td>
                      <td>
                        <Badge tone={s.status === 'completed' ? 'green' : 'red'}>
                          {s.status === 'completed' ? 'Completed' : 'Cancelled'}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!sales.data?.length && (
                <Empty
                  title="Your first sale is waiting"
                  text="Open the register to get started."
                />
              )}
            </div>
          )}
        </section>
        <section className="panel bestsellers">
          <div className="panel-header">
            <div>
              <h2>Best sellers</h2>
            </div>
            <span>↗</span>
          </div>
          {report.data?.products
            .filter((p) => p.quantity > 0)
            .slice(0, 4)
            .map((p, i) => (
              <div className="bestseller" key={p.product_id}>
                <span className="rank">0{i + 1}</span>
                <ProductAvatar product={p} />
                <div>
                  <strong>{p.name}</strong>
                  <small>{p.quantity} sold</small>
                  <span className="bestseller-track">
                    <i
                      style={{
                        width: `${(p.quantity / (report.data.products[0]?.quantity || 1)) * 100}%`,
                      }}
                    />
                  </span>
                </div>
                <b>{m(p.total)}</b>
              </div>
            ))}
          {!report.data?.products.length && (
            <Empty title="Favorites in the making" text="Best sellers appear after a sale." />
          )}
        </section>
      </div>
      {low.length > 0 && (
        <div className="stock-banner">
          <span className="stock-banner-icon">
            <TriangleAlert size={23} />
          </span>
          <div>
            <strong>{low.length} products need restocking</strong>
            <p>{low.filter((p) => !p.stock).length} out of stock</p>
          </div>
          <Link className="btn secondary" to="/inventory?status=low">
            Review stock
            <ArrowRight size={16} />
          </Link>
        </div>
      )}
      <SalesOverview />
    </div>
  );
}
