const registerForm = document.getElementById('registerForm');
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

registerForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearError();

  const first_name = document.getElementById('first_name').value.trim();
  const last_name = document.getElementById('last_name').value.trim();
  const email = document.getElementById('email').value.trim();
  const phone = document.getElementById('phone').value.trim();
  const password = document.getElementById('password').value;
  const confirm_password = document.getElementById('confirm_password').value;

  if (!first_name || !last_name || !email || !password) {
    showError('Please fill in all required fields.');
    return;
  }
  if (password.length < 8) {
    showError('Password must be at least 8 characters.');
    return;
  }
  if (password !== confirm_password) {
    showError('Passwords do not match.');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Creating account…';

  try {
    const data = await fetchMethod('/auth/register-patient', 'POST', {
      first_name, last_name, email, phone, password,
    });
    saveSession(data);
    window.location.href = 'patient-portal.html';
  } catch (err) {
    showError(err.message || 'Something went wrong. Please try again.');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Create account';
  }
});