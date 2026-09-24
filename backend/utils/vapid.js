const VAPID_MAILTO = 'mailto:notifications@teampulse.ir';

function readVapidKeys(env = process.env) {
  const publicKey = String(env.VAPID_PUBLIC_KEY || '').trim();
  const privateKey = String(env.VAPID_PRIVATE_KEY || '').trim();
  return {
    publicKey,
    privateKey,
    configured: Boolean(publicKey && privateKey),
  };
}

function configureWebPush(webpush, env = process.env, log) {
  const { publicKey, privateKey, configured } = readVapidKeys(env);
  if (!configured) {
    log?.warn?.('vapid_keys_missing');
    return false;
  }
  try {
    webpush.setVapidDetails(VAPID_MAILTO, publicKey, privateKey);
    return true;
  } catch (error) {
    log?.warn?.('vapid_keys_invalid', { message: error.message });
    return false;
  }
}

module.exports = { VAPID_MAILTO, readVapidKeys, configureWebPush };
