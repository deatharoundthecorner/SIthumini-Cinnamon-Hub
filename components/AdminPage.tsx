import React, { useEffect, useState } from 'react';
import AdminEditor from './AdminEditor';
import { Product } from '../types';

interface Props {
  products: Product[];
  onApply: (p: Product[]) => void;
}

const AdminPage: React.FC<Props> = ({ products, onApply }) => {
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch('/api/me', { credentials: 'include' });
        const j = await res.json();
        setIsAdminAuthenticated(!!j.authenticated);
      } catch (e) {
        setIsAdminAuthenticated(false);
      }
    };
    check();
  }, []);

  const handleLogin = async () => {
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (res.ok) {
        setIsAdminAuthenticated(true);
        setError('');
        setUsername(''); setPassword('');
        return;
      }
      const j = await res.json();
      setError(j.error || 'Login failed');
    } catch (e) {
      setError('Login failed');
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/logout', { method: 'POST', credentials: 'include' });
    } catch (e) { }
    setIsAdminAuthenticated(false);
  };

  return (
    <div className="min-h-screen bg-[#FAF9F6] py-12">
      <div className="container mx-auto px-4">
        <div className="max-w-4xl mx-auto bg-white rounded-2xl p-8 shadow">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold">Admin — Price Editor</h2>
            {isAdminAuthenticated && (
              <button onClick={handleLogout} className="px-3 py-2 border rounded">Logout</button>
            )}
          </div>

          {!isAdminAuthenticated ? (
            <div className="grid gap-4 md:grid-cols-[1fr_1fr_auto] items-end">
              <div>
                <label className="block text-xs font-bold uppercase text-gray-400 mb-2">Username</label>
                <input
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  autoComplete="username"
                  className="w-full border rounded px-3 py-3"
                  placeholder="Admin username"
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-gray-400 mb-2">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="current-password"
                  className="w-full border rounded px-3 py-3"
                  placeholder="Admin password"
                />
              </div>
              <button onClick={handleLogin} className="px-5 py-3 bg-[#8B4513] text-white rounded font-semibold">
                Login
              </button>
              <p className="md:col-span-3 text-sm text-gray-500">
                Admin access is protected by the server session cookie. Use the credentials configured in your backend environment.
              </p>
              {error && <div className="md:col-span-3 text-red-600 font-medium">{error}</div>}
            </div>
          ) : (
            <AdminEditor products={products} onApply={onApply} />
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminPage;
