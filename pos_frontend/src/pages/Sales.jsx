import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, ReceiptText, Ban, ShoppingBag, TrendingUp } from 'lucide-react';
import { useStore } from '../lib/storeContext';
import { useResource } from '../lib/useResource';
import { api, cash, dateTime, localDate, downloadCSV } from '../lib/api';
import {
  PageHeader,
  Button,
  SearchBox,
  Table,
  Badge,
  Loading,
  ErrorState,
  Confirm,
} from '../components/ui';
import { Metric } from './Dashboard';
import Receipt from '../components/Receipt';
export default function Sales() {
  const { data, user, refresh, notify } = useStore(),
    resource = useResource('/sales'),
    [params, setParams] = useSearchParams(),
    [search, setSearch] = useState(''),
    [method, setMethod] = useState('all'),
    [status, setStatus] = useState('all'),
    [date, setDate] = useState(''),
    [receipt, setReceipt] = useState(null),
    [cancel, setCancel] = useState(null),
    [opening, setOpening] = useState(false);
  const m = (v) => cash(v, data.settings.currency);
  const show = useCallback(
    async (id) => {
      setOpening(true);
      try {
        setReceipt(await api(`/sales/${id}`));
      } catch (e) {
        notify(e.message, 'error');
      } finally {
        setOpening(false);
      }
    },
    [notify],
  );
  useEffect(() => {
    const id = params.get('id');
    if (!id) return;
    let active = true;
    api(`/sales/${id}`)
      .then((sale) => {
        if (active) {
          setReceipt(sale);
          setParams({}, { replace: true });
        }
      })
      .catch((e) => {
        if (active) notify(e.message, 'error');
      });
    return () => {
      active = false;
    };
  }, [params, setParams, notify]);
  const rows = (resource.data || []).filter(
    (s) =>
      [s.number, s.customer || 'walk-in customer', s.cashier].some((v) =>
        v.toLowerCase().includes(search.toLowerCase()),
      ) &&
      (method === 'all' || s.payment_method === method) &&
      (status === 'all' || s.status === status) &&
      (!date || localDate(s.created_at, data.settings.timezone) === date),
  );
  const completed = rows.filter((s) => s.status === 'completed'),
    revenue = completed.reduce((sum, s) => sum + s.total, 0);
  return (
    <>
      <PageHeader
        eyebrow="EVERY SALE TELLS A STORY"
        title="Transactions"
        description={
          user.role === 'cashier'
            ? 'Your sales and receipts, all in one place.'
            : 'A clear record of every sale in your store.'
        }
      >
        <Button
          variant="secondary"
          disabled={!rows.length}
          onClick={() =>
            downloadCSV(
              'transactions',
              rows.map((s) => ({
                number: s.number,
                date: dateTime(s.created_at, data.settings.timezone),
                cashier: s.cashier,
                customer: s.customer || 'Walk-in',
                payment: s.payment_method,
                amount: (s.total / 100).toFixed(2),
                status: s.status,
              })),
            )
          }
        >
          <Download size={16} />
          Export
        </Button>
      </PageHeader>
      <div className="metrics-grid three">
        <Metric
          label="Sales in this view"
          value={m(revenue)}
          detail="Completed transactions only"
          icon={ShoppingBag}
        />
        <Metric
          label="Completed transactions"
          value={completed.length}
          detail={`${rows.filter((s) => s.status === 'cancelled').length} cancelled transactions`}
          icon={ReceiptText}
        />
        <Metric
          label="Average sale"
          value={m(completed.length ? revenue / completed.length : 0)}
          detail="Per completed transaction"
          icon={TrendingUp}
        />
      </div>
      <section className="panel">
        <div className="toolbar">
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Search receipt, customer, or cashier"
          />
          <div>
            <input
              type="date"
              aria-label="Transaction date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              aria-label="Payment method filter"
            >
              <option value="all">All payments</option>
              {[
                ...new Set([
                  ...(resource.data || []).map((s) => s.payment_method),
                  ...data.settings.payment_methods,
                ]),
              ].map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              aria-label="Transaction status"
            >
              <option value="all">All statuses</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
        </div>
        {resource.loading ? (
          <Loading />
        ) : resource.error ? (
          <ErrorState message={resource.error} retry={resource.reload} />
        ) : (
          <Table
            rows={rows}
            columns={[
              {
                key: 'number',
                label: 'Receipt',
                render: (s) => (
                  <button
                    className="transaction-number"
                    disabled={opening}
                    onClick={() => show(s.id)}
                  >
                    {s.number}
                  </button>
                ),
              },
              {
                key: 'created_at',
                label: 'Date',
                render: (s) => dateTime(s.created_at, data.settings.timezone),
              },
              {
                key: 'customer',
                label: 'Customer',
                render: (s) => s.customer || 'Walk-in customer',
              },
              { key: 'cashier', label: 'Cashier' },
              {
                key: 'payment_method',
                label: 'Payment',
                render: (s) => <span className="payment-label">{s.payment_method}</span>,
              },
              { key: 'total', label: 'Total', render: (s) => <strong>{m(s.total)}</strong> },
              {
                key: 'status',
                label: 'Status',
                render: (s) => (
                  <Badge tone={s.status === 'completed' ? 'green' : 'red'}>
                    {s.status === 'completed' ? 'Completed' : 'Cancelled'}
                  </Badge>
                ),
              },
              {
                key: 'actions',
                label: '',
                render: (s) => (
                  <div className="row-actions">
                    <button
                      aria-label={`View receipt ${s.number}`}
                      onClick={() => show(s.id)}
                      disabled={opening}
                    >
                      <ReceiptText size={17} />
                    </button>
                    {user.role !== 'cashier' && s.status === 'completed' && (
                      <button aria-label={`Cancel ${s.number}`} onClick={() => setCancel(s)}>
                        <Ban size={17} />
                      </button>
                    )}
                  </div>
                ),
              },
            ]}
          />
        )}
      </section>
      <p className="page-note">
        Showing up to 1,000 recent transactions. Reports export all completed sales within the
        selected date range.
      </p>
      {receipt && <Receipt sale={receipt} onClose={() => setReceipt(null)} />}{' '}
      {cancel && (
        <Confirm
          title="Cancel this transaction?"
          description={`${cancel.number} · ${m(cancel.total)}. All items will return to stock and the sale will be excluded from reports. Return the customer's payment separately before confirming.`}
          action="Cancel transaction"
          danger
          reason
          onClose={() => setCancel(null)}
          onConfirm={async (reason) => {
            await api(`/sales/${cancel.id}/cancel`, { method: 'POST', body: { reason } });
            await refresh();
            resource.reload();
            notify('Sale cancelled and stock restored');
          }}
        />
      )}
    </>
  );
}
