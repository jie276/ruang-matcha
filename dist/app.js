(() => {
  const menuButton = document.querySelector('.menu-toggle');
  const menu = document.querySelector('#mobile-menu');
  const closeMenu = () => { menu.hidden = true; menuButton.setAttribute('aria-expanded', 'false'); menuButton.setAttribute('aria-label', 'Open navigation'); };
  menuButton.addEventListener('click', () => { const open = menu.hidden; menu.hidden = !open; menuButton.setAttribute('aria-expanded', String(open)); menuButton.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation'); });
  menu.querySelectorAll('a,button').forEach(el => el.addEventListener('click', closeMenu));
  document.addEventListener('click', event => { if (!menu.hidden && !event.target.closest('.site-header')) closeMenu(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenu(); });
  window.addEventListener('resize', () => { if (innerWidth > 800) closeMenu(); });

  const linkDialog = document.querySelector('#link-dialog');
  const imageDialog = document.querySelector('#image-dialog');
  const titles = {store: 'Kedai TikTok / TikTok Shop', tin: 'Matcha · Tin 50g', pouch: 'Matcha · Pek 50g / 100g'};
  const openDialog = dialog => { dialog.showModal(); document.body.classList.add('modal-open'); };
  document.querySelectorAll('.shop-action').forEach(button => button.addEventListener('click', () => {
    const key = button.dataset.shop;
    const destination = window.MATCHA_LINKS?.[key];
    if (destination) {
      try { const url = new URL(destination); if (url.protocol === 'https:') { window.open(url.href, '_blank', 'noopener,noreferrer'); return; } } catch (_) { /* Show the preview message for an invalid configuration. */ }
    }
    document.querySelector('#link-dialog-title').textContent = titles[key];
    openDialog(linkDialog);
  }));
  document.querySelectorAll('.product-image-button').forEach(button => button.addEventListener('click', () => {
    const image = document.querySelector('#enlarged-image');
    image.src = button.dataset.image;
    image.alt = button.querySelector('img').alt;
    document.querySelector('#image-caption').textContent = button.dataset.caption;
    openDialog(imageDialog);
  }));
  document.querySelectorAll('dialog').forEach(dialog => {
    dialog.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
    dialog.querySelector('.dialog-dismiss')?.addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', event => { if (event.target !== dialog) return; const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); });
    dialog.addEventListener('close', () => document.body.classList.remove('modal-open'));
  });
  document.querySelectorAll('.size-option').forEach(button => button.addEventListener('click', () => {
    document.querySelectorAll('.size-option').forEach(option => { const selected = option === button; option.classList.toggle('selected', selected); option.setAttribute('aria-pressed', String(selected)); });
    document.querySelector('#selected-size').textContent = button.dataset.size;
  }));
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  if ('IntersectionObserver' in window && !reducedMotion.matches) {
    const reveals = document.querySelectorAll('.reveal');
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) { entry.target.classList.add('is-visible'); if (!entry.target.classList.contains('visual-reveal')) observer.unobserve(entry.target); }
      else if (entry.target.classList.contains('visual-reveal')) entry.target.classList.remove('is-visible');
    }), { threshold: 0.04 });
    reveals.forEach(el => { if (el.getBoundingClientRect().top < innerHeight) el.classList.add('is-visible'); observer.observe(el); });
    document.body.classList.add('motion-ready');
  }
  document.querySelector('#year').textContent = new Date().getFullYear();
})();
