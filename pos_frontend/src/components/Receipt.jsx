import { useState } from 'react';
import { Printer, Download, CheckCircle2 } from 'lucide-react';
import { Modal, Button } from './ui';
import { cash, dateTime } from '../lib/api';
export function ReceiptContent({ sale }) {
  const s = sale.receipt_store,
    m = (v) => cash(v, s.currency);
  return (
    <article className="receipt">
      <header>
        {s.logo_url && <img className="receipt-logo" src={s.logo_url} alt="Store logo" />}
        <h2>{s.name}</h2>
        <p>{s.address}</p>
        <p>{s.contact}</p>
        <strong>{sale.status === 'cancelled' ? 'CANCELLED TRANSACTION' : 'SALES RECEIPT'}</strong>
      </header>
      <div className="receipt-meta">
        <span>Receipt / Transaction</span>
        <b>{sale.number}</b>
        <span>{dateTime(sale.created_at, s.timezone)}</span>
        <span>Cashier: {sale.cashier}</span>
        <span>Customer: {sale.customer || 'Walk-in customer'}</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          {sale.items.map((i) => (
            <tr key={i.id}>
              <td>
                {i.name}
                <small>
                  {i.quantity} × {m(i.unit_price)}
                </small>
              </td>
              <td>{m(i.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="receipt-totals">
        <p>
          <span>Subtotal</span>
          <span>{m(sale.subtotal)}</span>
        </p>
        <p>
          <span>Discount ({sale.discount_percent}%)</span>
          <span>−{m(sale.discount)}</span>
        </p>
        <p>
          <span>Tax {s.tax_inclusive ? '(included)' : ''}</span>
          <span>{m(sale.tax)}</span>
        </p>
        <p className="grand-total">
          <b>TOTAL</b>
          <b>{m(sale.total)}</b>
        </p>
        <p>
          <span>{sale.payment_method}</span>
          <span>{m(sale.amount_received)}</span>
        </p>
        <p>
          <span>Change</span>
          <span>{m(sale.change)}</span>
        </p>
        {sale.payment_reference && (
          <p>
            <span>Reference</span>
            <span>{sale.payment_reference}</span>
          </p>
        )}
      </div>
      {sale.status === 'cancelled' && <p>Cancellation: {sale.cancel_reason}</p>}
      {!!sale.returns?.length && (
        <section className="receipt-return-summary">
          <strong>Linked returns</strong>
          <p>Original sale totals above are preserved.</p>
          {sale.returns.map((record) => (
            <p key={record.id}>
              {record.number} · {dateTime(record.created_at, s.timezone)} · Refund {m(record.total)}
            </p>
          ))}
        </section>
      )}
      <footer>
        <p>{s.receipt_footer}</p>
        <small>Powered by Suki POS</small>
      </footer>
    </article>
  );
}
export default function Receipt({ sale, onClose, completed = false }) {
  const [downloaded, setDownloaded] = useState(false);
  const download = async () => {
    const { renderToStaticMarkup } = await import('react-dom/server');
    const html =
      '<!doctype html><html><head><meta charset="utf-8"><title>Sales receipt</title><style>body{font:14px monospace;max-width:360px;margin:30px auto;color:#222}header,footer{text-align:center}h2{font-size:20px}.receipt-meta{display:grid;gap:6px;margin:18px 0}table{width:100%;border-top:1px dashed #888;border-bottom:1px dashed #888;padding:10px 0}th,td{text-align:left;padding:6px 0}td:last-child,th:last-child{text-align:right}td small{display:block}.receipt-totals p{display:flex;justify-content:space-between}.grand-total{font-size:18px}.receipt-logo{width:64px}footer{margin-top:24px}</style></head><body>' +
      renderToStaticMarkup(<ReceiptContent sale={sale} />) +
      '</body></html>';
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' })),
      a = document.createElement('a');
    a.href = url;
    a.download = `${sale.number}.html`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setDownloaded(true);
  };
  return (
    <Modal
      title={completed ? 'Sale complete!' : 'Transaction receipt'}
      subtitle={completed ? 'Payment recorded and inventory updated.' : sale.number}
      onClose={onClose}
    >
      {completed && (
        <div className="receipt-success">
          <CheckCircle2 size={21} />
          <span>
            Change due <strong>{cash(sale.change, sale.receipt_store.currency)}</strong>
          </span>
        </div>
      )}
      <div className="receipt-paper">
        <ReceiptContent sale={sale} />
      </div>
      <footer>
        <Button variant="secondary" onClick={download}>
          <Download size={16} />
          {downloaded ? 'Downloaded' : 'Download'}
        </Button>
        <Button variant="secondary" onClick={() => window.print()}>
          <Printer size={16} />
          Print
        </Button>
        <Button onClick={onClose}>{completed ? 'New sale' : 'Done'}</Button>
      </footer>
    </Modal>
  );
}
