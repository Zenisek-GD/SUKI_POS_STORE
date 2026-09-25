import { useEffect, useState } from 'react';
import { ArrowRight, Eye, EyeOff, ShoppingBag, Check, BarChart3, Boxes } from 'lucide-react';
import { Brand } from '../components/Layout';
import { Button, Field, ErrorState } from '../components/ui';
import { api } from '../lib/api';
import { useStore } from '../lib/storeContext';
const demos = {
  admin: ['owner@suki.store', 'SukiOwner2026!'],
  cashier: ['cashier@suki.store', 'SukiCashier2026!'],
  manager: ['manager@suki.store', 'SukiManager2026!'],
  inventory: ['inventory@suki.store', 'SukiInventory2026!'],
};
export default function Login() {
  const { login } = useStore(),
    [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [show, setShow] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [demo, setDemo] = useState(false);
  useEffect(() => {
    api('/auth/info')
      .then((r) => setDemo(r.demo))
      .catch((e) => setError(e.message));
  }, []);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login({ email, password });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login-page">
      <section className="login-story">
        <Brand />
        <div className="story-content">
          <span className="story-tag">
            <i />
            YOUR EVERYDAY STORE COMPANION
          </span>
          <h1>
            Good business
            <br />
            starts with
            <br />
            <span>simple things.</span>
          </h1>
          <p>
            From your first sale to your next big milestone.
            <br />
            Everything your neighborhood store needs,
            <br />
            all in one familiar place.
          </p>
          <div className="story-features">
            <span>
              <ShoppingBag />
              Sell with ease
            </span>
            <span>
              <Boxes />
              Stay stocked
            </span>
            <span>
              <BarChart3 />
              See your growth
            </span>
          </div>
          <div className="story-card">
            <div className="story-card-icon">
              <Check size={23} />
            </div>
            <div>
              <strong>One less thing to worry about.</strong>
              <p>Your sales, stock, and records. All together.</p>
            </div>
          </div>
        </div>
        <footer>Built for small businesses. Made for everyday.</footer>
      </section>
      <section className="login-form-side">
        <div className="login-mobile-brand">
          <Brand />
        </div>
        <div className="login-form">
          <span className="eyebrow">LET’S OPEN UP SHOP</span>
          <h2>Welcome back.</h2>
          <p>Sign in to take care of your store.</p>
          <form onSubmit={submit}>
            <Field label="Email address">
              <input
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="you@suki.store"
              />
            </Field>
            <Field label="Password">
              <div className="password-input">
                <input
                  type={show ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  maxLength={72}
                  placeholder="Enter your password"
                />
                <button
                  type="button"
                  aria-label={show ? 'Hide password' : 'Show password'}
                  onClick={() => setShow((v) => !v)}
                >
                  {show ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </Field>
            {error && <ErrorState message={error} />}
            <Button loading={busy} className="login-submit">
              Sign in to your store <ArrowRight size={18} />
            </Button>
          </form>
          {demo && (
            <div className="demo-panel">
              <span>EXPLORE THE DEMO STORE</span>
              <p>Choose a role to fill in its sample credentials.</p>
              <div>
                {Object.entries(demos).map(([role, credentials]) => (
                  <button
                    key={role}
                    type="button"
                    onClick={() => {
                      setEmail(credentials[0]);
                      setPassword(credentials[1]);
                    }}
                  >
                    {role === 'admin'
                      ? 'Store owner'
                      : role === 'inventory'
                        ? 'Inventory'
                        : role.charAt(0).toUpperCase() + role.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          )}
          <p className="login-help">Need access? Ask your store owner to create an account.</p>
        </div>
        <span className="login-copyright">
          © {new Date().getFullYear()} Suki POS. Your store, made simpler.
        </span>
      </section>
    </div>
  );
}
