import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { StoreProvider } from './lib/store';
import { useStore } from './lib/storeContext';
import { Loading, ErrorState } from './components/ui';
import Layout from './components/Layout';
import { navigation } from './lib/navigation';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import POS from './pages/POS';
import Products from './pages/Products';
import Inventory from './pages/Inventory';
import Sales from './pages/Sales';
import { People, Purchases, Expenses, Team, Audit, Account } from './pages/Management';
import Reports from './pages/Reports';
import Settings from './pages/Settings';
import './App.css';
function Content() {
  const { user, data, loading, error, initialize } = useStore();
  if (loading)
    return (
      <div className="boot">
        <Loading />
      </div>
    );
  if (error)
    return (
      <div className="boot">
        <ErrorState message={error} retry={initialize} />
      </div>
    );
  if (!user || !data) return <Login />;
  const home = user.role === 'cashier' ? '/pos' : user.role === 'inventory' ? '/inventory' : '/';
  const pages = {
    '/': <Dashboard />,
    '/pos': <POS />,
    '/products': <Products />,
    '/inventory': <Inventory />,
    '/sales': <Sales />,
    '/customers': <People entity="customers" />,
    '/suppliers': <People entity="suppliers" />,
    '/purchases': <Purchases />,
    '/expenses': <Expenses />,
    '/team': <Team />,
    '/audit': <Audit />,
    '/reports': <Reports />,
    '/settings': <Settings />,
  };
  return (
    <Routes>
      <Route element={<Layout />}>
        {navigation.map((n) => (
          <Route
            key={n.path}
            path={n.path}
            element={n.roles.includes(user.role) ? pages[n.path] : <Navigate to={home} replace />}
          />
        ))}
        <Route path="/account" element={<Account />} />
        <Route path="*" element={<Navigate to={home} replace />} />
      </Route>
    </Routes>
  );
}
export default function App() {
  return (
    <BrowserRouter>
      <StoreProvider>
        <Content />
      </StoreProvider>
    </BrowserRouter>
  );
}
