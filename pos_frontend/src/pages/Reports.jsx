import { useState } from 'react';
import { Download, CalendarDays, ShoppingBag, TrendingUp, Wallet, ReceiptText } from 'lucide-react';
import { useStore } from '../lib/storeContext';
import { useResource } from '../lib/useResource';
import { cash, dateRange, downloadCSV, titleCase, dateTime } from '../lib/api';
import { PageHeader, Button, Table, Loading, ErrorState } from '../components/ui';
import { Metric, SalesChart, CategoryChart } from './Dashboard';
import SalesOverview from '../components/SalesOverview';
import './Insights.css';
const reports = [
  ['daily', 'Daily sales'],
  ['transactions', 'Sales transactions'],
  ['returns', 'Customer returns'],
  ['products', 'Product sales'],
  ['categories', 'Category sales'],
  ['inventory', 'Inventory'],
  ['movements', 'Stock movements'],
  ['low', 'Low-stock products'],
  ['purchases', 'Purchases'],
  ['expenses', 'Expenses'],
  ['profit', 'Profit summary'],
  ['cashiers', 'Cashier performance'],
  ['payments', 'Payment methods'],
];
const moneyFields = [
  'total',
  'gross_sales',
  'sales',
  'discounts',
  'tax',
  'cost',
  'expenses',
  'profit',
  'amount',
  'subtotal',
  'discount',
  'cost_price',
  'price',
  'value',
  'refunds',
  'collected_sales',
  'cost_total',
];
function reportRows(report, type) {
  if (type === 'low') return report.inventory.filter((p) => p.stock <= p.min_stock);
  if (type === 'profit')
    return [
      {
        gross_sales: report.summary.gross_sales,
        discounts: report.summary.discounts,
        tax: report.summary.tax,
        sales: report.summary.sales,
        refunds: report.summary.refunds,
        cost: report.summary.cost,
        expenses: report.summary.expenses,
        profit: report.summary.profit,
      },
    ];
  return report[type] || [];
}
const fields = {
  daily: ['date', 'transactions', 'refunds', 'total'],
  returns: ['number', 'original_receipt', 'created_at', 'operator', 'reason', 'total', 'tax'],
  transactions: [
    'number',
    'created_at',
    'cashier',
    'payment_method',
    'subtotal',
    'discount',
    'tax',
    'total',
  ],
  products: ['name', 'quantity', 'gross_sales', 'total'],
  categories: ['name', 'quantity', 'total'],
  inventory: ['name', 'sku', 'category', 'stock', 'min_stock', 'cost_price', 'price', 'value'],
  low: ['name', 'sku', 'stock', 'min_stock'],
  movements: [
    'product',
    'previous_quantity',
    'quantity',
    'new_quantity',
    'type',
    'reason',
    'user_name',
    'created_at',
  ],
  purchases: ['number', 'supplier', 'purchase_date', 'total', 'payment_status', 'receiving_status'],
  expenses: ['description', 'category', 'expense_date', 'amount'],
  profit: ['gross_sales', 'discounts', 'refunds', 'tax', 'sales', 'cost', 'expenses', 'profit'],
  cashiers: ['name', 'transactions', 'total'],
  payments: ['name', 'transactions', 'total'],
};
export default function Reports() {
  const { data } = useStore(),
    [range, setRange] = useState(dateRange(7, data.settings.timezone)),
    [draft, setDraft] = useState(range),
    [type, setType] = useState('daily');
  const resource = useResource(`/reports?from=${range.from}&to=${range.to}`),
    report = resource.data,
    rows = report ? reportRows(report, type) : [];
  const columns = fields[type].map((key) => ({
    key,
    label:
      {
        total:
          type === 'products' || type === 'categories' || type === 'daily'
            ? 'Net sales'
            : type === 'returns'
              ? 'Refund amount'
              : 'Total',
        cost: 'Cost of goods',
        profit: 'Estimated profit',
        value: 'Stock value',
        min_stock: 'Minimum stock',
        user_name: 'Team member',
        price: 'Selling price',
        sales: 'Net sales collected',
        gross_sales: 'Gross sales',
      }[key] || titleCase(key),
    render: (r) =>
      moneyFields.includes(key)
        ? cash(r[key], data.settings.currency)
        : key === 'created_at'
          ? dateTime(r[key], data.settings.timezone)
          : String(r[key] ?? '—'),
  }));
  const exportReport = () =>
    downloadCSV(
      `${type}-${range.from}-${range.to}`,
      rows.map((r) =>
        Object.fromEntries(
          fields[type].map((key) => [
            key,
            moneyFields.includes(key) ? (Number(r[key] || 0) / 100).toFixed(2) : r[key],
          ]),
        ),
      ),
    );
  return (
    <div className="insights-page reports-page">
      <PageHeader
        eyebrow="KNOW YOUR BUSINESS BETTER"
        title="Reports & insights"
        description="Make your next decision with a clearer picture."
      >
        <Button variant="secondary" disabled={!rows.length} onClick={exportReport}>
          <Download size={16} />
          Export CSV
        </Button>
      </PageHeader>
      <form
        className="report-filters"
        onSubmit={(e) => {
          e.preventDefault();
          setRange({ ...draft });
        }}
      >
        <span>
          <CalendarDays size={19} />
          Reporting period
        </span>
        <div className="period-buttons">
          {[
            [1, 'Today'],
            [7, 'Week'],
            [30, 'Month'],
          ].map(([days, label]) => (
            <button
              type="button"
              key={days}
              aria-pressed={
                range.from === dateRange(days, data.settings.timezone).from &&
                range.to === dateRange(days, data.settings.timezone).to
              }
              onClick={() => {
                const next = dateRange(days, data.settings.timezone);
                setDraft(next);
                setRange(next);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <details className="report-custom-dates">
          <summary>Custom dates</summary>
          <div className="report-custom-fields">
            <label className="date-field">
              From
              <input
                type="date"
                required
                aria-label="Report start date"
                value={draft.from}
                max={draft.to}
                onChange={(e) => setDraft((v) => ({ ...v, from: e.target.value }))}
              />
            </label>
            <label className="date-field">
              To
              <input
                type="date"
                required
                aria-label="Report end date"
                value={draft.to}
                min={draft.from}
                onChange={(e) => setDraft((v) => ({ ...v, to: e.target.value }))}
              />
            </label>
            <Button type="submit">Apply</Button>
          </div>
        </details>
      </form>
      {resource.loading ? (
        <Loading />
      ) : resource.error ? (
        <ErrorState message={resource.error} retry={resource.reload} />
      ) : (
        report && (
          <>
            <div className="metrics-grid">
              <Metric
                label="Net sales collected"
                value={cash(report.summary.sales, data.settings.currency)}
                detail={`${report.summary.transactions} sales · ${cash(report.summary.refunds, data.settings.currency)} refunded`}
                icon={ShoppingBag}
                tone="featured"
              />
              <Metric
                label="Gross sales"
                value={cash(report.summary.gross_sales, data.settings.currency)}
                detail="Recorded item prices before discounts"
                icon={ReceiptText}
              />
              <Metric
                label="Expenses"
                value={cash(report.summary.expenses, data.settings.currency)}
                detail="Recorded during this period"
                icon={Wallet}
              />
              <Metric
                label="Estimated profit"
                value={cash(report.summary.profit, data.settings.currency)}
                detail="After refunds, tax, cost, and expenses"
                icon={TrendingUp}
              />
            </div>
            <section className="panel report-results">
              <div className="toolbar">
                <div>
                  <h2>{reports.find((r) => r[0] === type)?.[1]}</h2>
                  <span className="report-count">{rows.length} records</span>
                </div>
                <select
                  aria-label="Report type"
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                >
                  {reports.map(([key, label]) => (
                    <option value={key} key={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <Table rows={rows} columns={columns} />
              <details className="report-explanation">
                <summary>About this report</summary>
                <p className="muted report-note">
                  {['inventory', 'low'].includes(type)
                    ? 'Current stock snapshot. These quantities are not limited by the date range.'
                    : type === 'profit'
                      ? 'Profit excludes collected tax and refunds processed in this period. Sellable returns reverse their original cost; damaged returns remain a cost.'
                      : type === 'products' || type === 'categories'
                        ? 'Net sales are after discounts and refunds and exclude tax; refunds follow their processing date. Quantities are sales less returns in this period.'
                        : type === 'transactions'
                          ? 'Original completed transactions. Linked refunds are listed separately under Customer returns and deducted from financial totals.'
                          : 'Completed sales less refunds processed in this period, using the store timezone. Voided transactions are excluded.'}
                </p>
              </details>
            </section>
            {type === 'categories' && (
              <div className="panel standalone-category">
                <CategoryChart rows={report.categories} currency={data.settings.currency} />
              </div>
            )}
            <div className="dashboard-charts report-charts">
              <section className="panel">
                <div className="panel-header">
                  <div>
                    <h2>Sales over time</h2>
                    <p>
                      {range.from} — {range.to}
                    </p>
                  </div>
                </div>
                <SalesChart daily={report.daily} {...range} currency={data.settings.currency} />
              </section>
              <section className="panel">
                <div className="panel-header">
                  <div>
                    <h2>Payment mix</h2>
                    <p>Payments less refunds processed during this period.</p>
                  </div>
                </div>
                <div className="payment-bars">
                  {report.payments.map((p, i) => (
                    <div key={p.name}>
                      <div>
                        <span>
                          <i
                            style={{
                              background: ['#46765b', '#829f73', '#bdc995', '#d5b775'][i % 4],
                            }}
                          />
                          {p.name}
                        </span>
                        <b>{cash(p.total, data.settings.currency)}</b>
                      </div>
                      <div className="bar-track">
                        <span
                          style={{
                            width: `${
                              (Math.max(0, Number(p.total)) /
                                Math.max(
                                  1,
                                  report.payments.reduce(
                                    (sum, item) => sum + Math.max(0, Number(item.total)),
                                    0,
                                  ),
                                )) *
                              100
                            }%`,
                          }}
                        />
                      </div>
                      <small>{p.transactions} transactions</small>
                    </div>
                  ))}
                  {!report.payments.length && (
                    <p className="muted">Payment totals appear after your first sale.</p>
                  )}
                </div>
              </section>
            </div>
          </>
        )
      )}
      <SalesOverview />
    </div>
  );
}
