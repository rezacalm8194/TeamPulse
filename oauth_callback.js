(function () {
  const status = document.getElementById('msg');
  const hashParams = new URLSearchParams(String(window.location.hash || '').replace(/^#/, ''));
  const queryParams = new URLSearchParams(String(window.location.search || '').replace(/^\?/, ''));
  function readParam(name) {
    return hashParams.get(name) || queryParams.get(name);
  }
  const accessToken = readParam('access_token');
  const expiresIn = Number(readParam('expires_in') || 3600);
  const state = readParam('state') || '';
  const error = readParam('error');
  const errorDescription = readParam('error_description');
  if (!/^(gcal|gdrive)_[a-z0-9]+$/i.test(state)) {
    if (status) status.textContent = 'درخواست اتصال معتبر نیست.';
    setTimeout(function () { window.close(); }, 800);
    return;
  }
  const messageType = state.indexOf('gcal_') === 0 ? 'gcal_token' : 'gdrive_token';
  const payload = error
    ? { type: messageType, error: errorDescription || error, state: state }
    : {
      type: messageType,
      token: accessToken,
      expires_in: Number.isFinite(expiresIn) ? expiresIn : 3600,
      state: state
    };
  if (!error && !accessToken) payload.error = 'no_token_returned';

  try {
    localStorage.setItem('teampulse_oauth_result_' + state, JSON.stringify({
      type: payload.type,
      error: payload.error || null,
      token: payload.token || null,
      expires_in: payload.expires_in || 3600,
      state: payload.state,
      saved_at: Date.now()
    }));
  } catch (storageErr) {}

  try {
    if ('BroadcastChannel' in window) {
      const channel = new BroadcastChannel('teampulse_oauth');
      channel.postMessage(payload);
      setTimeout(function () { channel.close(); }, 1000);
    }
  } catch (channelErr) {}

  if (!window.opener || window.opener.closed) {
    if (status) {
      status.textContent = payload.error
        ? 'اتصال انجام نشد. این صفحه را ببند و دوباره تلاش کن.'
        : 'اتصال دریافت شد. به صفحه اصلی TeamPulse برگرد.';
    }
    setTimeout(function () { window.close(); }, 800);
    return;
  }

  try {
    window.opener.postMessage(payload, window.location.origin);
    if (status) {
      status.textContent = payload.error
        ? 'اتصال انجام نشد.'
        : 'اتصال با موفقیت انجام شد. این پنجره بسته می‌شود.';
    }
    setTimeout(function () { window.close(); }, 300);
  } catch (err) {
    if (status) status.textContent = 'ارسال نتیجه اتصال به TeamPulse ناموفق بود.';
  }
})();
