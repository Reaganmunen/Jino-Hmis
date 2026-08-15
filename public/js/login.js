const loginForm = document.getElementById('loginForm');
const formError = document.getElementById('formError');
const submitBtn = document.getElementById('submitBtn');

const showError = (message) => {
  formError.textContent = message;
  formError.classList.add('visible');
};

const clearError = () => {
  formError.textContent = '';
  formError.classList.remove('visible');
};

// Where to send each role after login. Update these as each role's
// dashboard folder gets built (public/dentist/, public/receptionist/, etc.)
const roleRedirects = {
  admin: 'admin/dashboard.html',
  dentist: 'dentist/dashboard.html',
  receptionist: 'receptionist/dashboard.html',
  patient: 'patient/patient-portal.html',
};

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearError();

  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  if (!email || !password) {
    showError('Enter both your email and password.');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Logging in…';

  try {
    const data = await fetchMethod('/auth/login', 'POST', { email, password });
    saveSession(data);
    window.location.href = roleRedirects[data.user.role] || 'dashboard.html';
  } catch (err) {
    showError(err.message || 'Something went wrong. Please try again.');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Log in';
  }
});