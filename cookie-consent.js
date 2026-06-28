const CONSENT_COOKIE = 'cookie_consent';
const CONSENT_MAX_AGE_SEC = 60 * 60 * 24 * 365;

function getConsent() {
  const match = document.cookie.match(/(?:^|; )cookie_consent=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function setConsentCookie(value) {
  document.cookie = CONSENT_COOKIE + '=' + encodeURIComponent(value) +
    '; max-age=' + CONSENT_MAX_AGE_SEC + '; path=/; SameSite=Lax';
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

async function syncConsentToServer(value) {
  const response = await fetch('/api/cookie-consent', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ consent: value })
  });

  if (!response.ok) {
    throw new Error('API unavailable');
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error('Invalid response');
  }

  const data = await response.json();
  if (!data.ok) {
    throw new Error(data.message || 'Server rejected consent');
  }
}

async function saveConsent(value) {
  setConsentCookie(value);
  hideCookieBanner();

  try {
    await syncConsentToServer(value);
  } catch (e) {
    // Сервер недоступен (file://, Live Preview) — локальная cookie уже сохранена
  }
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
    saveConsent('accepted');
  });

  rejectBtn.addEventListener('click', function () {
    saveConsent('rejected');
  });
}

document.addEventListener('DOMContentLoaded', initCookieBanner);
