// Shared fetch wrapper used across all frontend pages.
// Reads/writes the JWT in localStorage under 'jino_token'.

const API_BASE = '/api';

const fetchMethod = async (endpoint, method = 'GET', body = null, auth = false) => {
  const headers = { 'Content-Type': 'application/json' };

  if (auth) {
    const token = localStorage.getItem('jino_token');
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const options = { method, headers };
  if (body) options.body = JSON.stringify(body);

  const response = await fetch(`${API_BASE}${endpoint}`, options);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || `Request failed with status ${response.status}`);
  }

  return data;
};

const saveSession = ({ token, user }) => {
  localStorage.setItem('jino_token', token);
  localStorage.setItem('jino_user', JSON.stringify(user));
};

const getStoredUser = () => {
  const raw = localStorage.getItem('jino_user');
  return raw ? JSON.parse(raw) : null;
};

const clearSession = () => {
  localStorage.removeItem('jino_token');
  localStorage.removeItem('jino_user');
};