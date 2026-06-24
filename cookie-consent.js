const CONSENT_COOKIE = 'cookie_consent';

function getConsent() {
  const match = document.cookie.match(/(?:^|; )cookie_consent=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function hideCookieBanner() {
  const banner = document.getElementById('cookieBanner');
  if (banner) {
    banner.classList.add('cookie-banner--hidden');
    banner.setAttribute('aria-hidden', 'true');
  }
}

function showCookieBanner() {
  const banner = document.getElementById('cookieBanner');
  if (banner) {
    banner.classList.remove('cookie-banner--hidden');
    banner.setAttribute('aria-hidden', 'false');
  }
}

async function saveConsent(value) {
  const response = await fetch('/api/cookie-consent', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ consent: value })
  });

  const data = await response.json();

  if (!data.ok) {
    throw new Error(data.message || 'Не удалось сохранить выбор');
  }

  hideCookieBanner();
}

function initCookieBanner() {
  const banner = document.getElementById('cookieBanner');
  const acceptBtn = document.getElementById('cookieAccept');
  const rejectBtn = document.getElementById('cookieReject');

  if (!banner || !acceptBtn || !rejectBtn) {
    return;
  }

  if (getConsent()) {
    hideCookieBanner();
    return;
  }

  showCookieBanner();

  acceptBtn.addEventListener('click', function () {
    saveConsent('accepted').catch(function () {
      alert('Не удалось сохранить согласие. Попробуйте ещё раз.');
    });
  });

  rejectBtn.addEventListener('click', function () {
    saveConsent('rejected').catch(function () {
      alert('Не удалось сохранить выбор. Попробуйте ещё раз.');
    });
  });
}

document.addEventListener('DOMContentLoaded', initCookieBanner);
