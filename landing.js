// Show the signed-in state without redirecting from the landing page.
(function () {
  try {
    const session = localStorage.getItem('tp_session');
    if (!session) return;
    const parsed = JSON.parse(session);
    if (!parsed || !parsed.token) return;
    document.querySelectorAll('.btn-nav-login').forEach(function (button) {
      button.textContent = '← ورود به حساب';
      button.style.background = 'var(--accent)';
      button.style.color = 'white';
      button.style.borderColor = 'var(--accent)';
    });
  } catch (e) {}
})();

const observer = new IntersectionObserver(function (entries) {
  entries.forEach(function (entry) {
    if (entry.isIntersecting) {
      entry.target.style.opacity = '1';
      entry.target.style.transform = 'translateY(0)';
    }
  });
}, { threshold: 0.1 });

document.querySelectorAll('.feature-card,.job-chip').forEach(function (element) {
  element.style.opacity = '0';
  element.style.transform = 'translateY(20px)';
  element.style.transition = 'opacity .5s ease,transform .5s ease';
  observer.observe(element);
});
