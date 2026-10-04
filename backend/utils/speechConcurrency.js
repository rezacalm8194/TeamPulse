function createSpeechConcurrencyGuard(maxConcurrent) {
  const max = Math.max(1, Number(maxConcurrent) || 1);
  let active = 0;

  function speechConcurrencyGuard(req, res, next) {
    if (active >= max) {
      return res.status(429).json({
        error: 'speech_busy',
        message: 'در حال حاضر ظرفیت تبدیل صدا پر است. کمی بعد دوباره تلاش کنید.',
      });
    }
    active += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      active -= 1;
    };
    res.on('finish', release);
    res.on('close', release);
    next();
  }

  speechConcurrencyGuard._active = () => active;
  speechConcurrencyGuard._max = max;
  return speechConcurrencyGuard;
}

module.exports = { createSpeechConcurrencyGuard };
