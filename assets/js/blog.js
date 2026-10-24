/* HEYWEEN: light-only pages, progressive article navigation and original motion. */
(() => {
  'use strict';
  const $ = (selector, parent = document) => parent.querySelector(selector);
  const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const base = document.body.dataset.baseurl || '';
  const isHome = document.body.dataset.home === 'true';
  const header = $('#site-header');
  const motion = (target, options) => {
    if (!reduced.matches && window.anime) return window.anime.animate(target, options);
  };

  // Server-rendered navigation and articles remain usable without JavaScript.
  const updateNav = () => {
    const active = $('nav a[aria-current]', header), indicator = $('.nav-indicator', header);
    if (active && indicator) {
      indicator.style.width = `${active.offsetWidth}px`;
      indicator.style.transform = `translateX(${active.offsetLeft}px)`;
    }
  };
  updateNav();
  window.addEventListener('resize', updateNav, {passive: true});
  document.fonts?.ready.then(updateNav);
  const hero = $('.hero-image'), progress = $('.reading-progress');
  let scrollPending = false;
  const updateScroll = () => {
    if (isHome) header.classList.toggle('solid', scrollY > 80);
    if (hero && !reduced.matches) hero.style.transform = `translateY(${Math.min(scrollY * .13, 75)}px)`;
    if (progress) {
      const article = $('#article-content');
      const start = article.getBoundingClientRect().top + scrollY;
      const distance = article.offsetHeight - innerHeight + 100;
      progress.style.width = `${Math.min(100, Math.max(0, (scrollY - start + 100) / Math.max(1, distance) * 100))}%`;
    }
    scrollPending = false;
  };
  updateScroll();
  window.addEventListener('scroll', () => {
    if (!scrollPending) { scrollPending = true; requestAnimationFrame(updateScroll); }
  }, {passive: true});

  // One shared state keeps the visible face, focus and available links in sync.
  const touchTopics = matchMedia('(hover: none), (max-width: 620px)');
  const topicCards = $$('[data-topic-card]');
  const setTopicFace = (card, flipped, focusArticle = false) => {
    const button = $('.topic-flip', card), front = $('.topic-front', card), back = $('.topic-back', card);
    card.classList.toggle('is-flipped', flipped);
    button.setAttribute('aria-expanded', String(flipped));
    const visible = flipped ? back : front, hidden = flipped ? front : back;
    visible.inert = false;
    visible.removeAttribute('aria-hidden');
    if (flipped && (focusArticle || front.contains(document.activeElement))) {
      $('a', back).focus({preventScroll: true});
    } else if (!flipped && back.contains(document.activeElement)) {
      button.focus({preventScroll: true});
    }
    hidden.inert = true;
    hidden.setAttribute('aria-hidden', 'true');
  };
  for (const card of topicCards) {
    const button = $('.topic-flip', card), front = $('.topic-front', card);
    button.hidden = false;
    setTopicFace(card, false);
    button.addEventListener('click', () => setTopicFace(card, !card.classList.contains('is-flipped'), true));
    front.addEventListener('click', event => {
      if (!touchTopics.matches || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.detail === 0) return;
      event.preventDefault();
      topicCards.forEach(other => { if (other !== card) setTopicFace(other, false); });
      setTopicFace(card, true);
    });
    card.addEventListener('mouseenter', () => { if (!touchTopics.matches) setTopicFace(card, true); });
    card.addEventListener('mouseleave', () => {
      if (!touchTopics.matches && !card.contains(document.activeElement)) setTopicFace(card, false);
    });
    card.addEventListener('focusin', event => {
      if (event.target === front && !touchTopics.matches) setTopicFace(card, true, true);
    });
    card.addEventListener('focusout', event => {
      if (!card.contains(event.relatedTarget) && !(card.matches(':hover') && !touchTopics.matches)) setTopicFace(card, false);
    });
    card.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        button.focus({preventScroll: true});
        setTopicFace(card, false);
      }
    });
  }

  // Full catalog: every row and permanent URL already exists in the HTML.
  const catalog = $('#catalog');
  if (catalog) {
    const rows = $$('#article-list .post-row');
    const select = $('#category-filter'), input = $('#list-search');
    const categoryNames = new Set([...select.options].map(option => option.value));
    const entries = rows.map(row => ({row, categories: JSON.parse(row.dataset.categories), text: row.textContent.toLocaleLowerCase()}));
    let syncPicker = () => {};
    const paint = (remember = false, animate = false) => {
      const category = select.value, query = input.value.trim().toLocaleLowerCase();
      let count = 0;
      for (const entry of entries) {
        entry.row.hidden = !!((category && !entry.categories.includes(category)) || (query && !entry.text.includes(query)));
        if (!entry.row.hidden) count++;
      }
      $('#catalog-count').textContent = category ? `${category.replace(/ⅠⅠ/g, 'Ⅱ')} · ${count} 篇` : `共 ${count} 篇`;
      $('#catalog-empty').hidden = count > 0;
      if (remember) {
        const url = new URL(location.href);
        category ? url.searchParams.set('category', category) : url.searchParams.delete('category');
        query ? url.searchParams.set('q', input.value.trim()) : url.searchParams.delete('q');
        history.replaceState(null, '', url);
      }
      if (animate) motion($('#article-list'), {opacity: [.45, 1], y: [4, 0], duration: 220, ease: 'outQuad'});
      syncPicker();
    };
    const readQuery = () => {
      const params = new URLSearchParams(location.search), requested = params.get('category') || '';
      select.value = categoryNames.has(requested) ? requested : '';
      input.value = params.get('q') || '';
      paint();
    };
    select.addEventListener('change', () => paint(true, true));
    input.addEventListener('input', () => paint(true));
    $('#reset-catalog').addEventListener('click', () => { select.value = ''; input.value = ''; paint(true, true); input.focus(); });
    window.addEventListener('popstate', readQuery);
    readQuery();

    // Enhance the real select; its values and no-script fallback remain the source of truth.
    const categoryLabel = $('label[for="category-filter"]', catalog);
    const picker = document.createElement('div'); picker.className = 'category-picker';
    const trigger = document.createElement('button');
    trigger.type = 'button'; trigger.id = 'category-picker-toggle'; trigger.className = 'category-picker-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox'); trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', 'category-picker-options');
    categoryLabel.id = 'category-filter-label';
    const triggerText = document.createElement('span'); triggerText.id = 'category-picker-current'; trigger.append(triggerText);
    trigger.setAttribute('aria-labelledby', 'category-filter-label category-picker-current');
    const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    chevron.setAttribute('viewBox', '0 0 24 24'); chevron.setAttribute('aria-hidden', 'true');
    const chevronPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    chevronPath.setAttribute('d', 'm6 9 6 6 6-6'); chevron.append(chevronPath); trigger.append(chevron);
    const options = document.createElement('div'); options.className = 'category-picker-options';
    options.id = 'category-picker-options'; options.setAttribute('role', 'listbox');
    options.setAttribute('aria-label', '全部分类'); options.hidden = true;
    const choices = [...select.options].map(option => {
      const choice = document.createElement('button'); choice.type = 'button'; choice.tabIndex = -1;
      choice.className = 'category-picker-option'; choice.setAttribute('role', 'option'); choice.dataset.value = option.value;
      const check = document.createElement('span'); check.className = 'category-picker-check'; check.textContent = '✓'; check.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span'); label.className = 'category-picker-name'; label.textContent = option.textContent.replace(/（\d+）$/, '');
      choice.append(check, label);
      const count = option.textContent.match(/（(\d+)）$/);
      if (count) { const total = document.createElement('span'); total.className = 'category-picker-count'; total.textContent = count[1]; choice.append(total); }
      choice.addEventListener('click', () => {
        select.value = option.value; select.dispatchEvent(new Event('change', {bubbles: true})); closePicker(true);
      });
      options.append(choice); return choice;
    });
    syncPicker = () => {
      triggerText.textContent = select.selectedOptions[0].textContent;
      choices.forEach(choice => choice.setAttribute('aria-selected', String(choice.dataset.value === select.value)));
    };
    const closePicker = (restoreFocus = false) => {
      options.hidden = true; trigger.setAttribute('aria-expanded', 'false');
      if (restoreFocus) trigger.focus();
    };
    const focusChoice = index => {
      const choice = choices[(index + choices.length) % choices.length];
      choice.focus({preventScroll: true}); choice.scrollIntoView({block: 'nearest'});
    };
    const openPicker = (index = select.selectedIndex) => {
      options.hidden = false; trigger.setAttribute('aria-expanded', 'true'); focusChoice(index);
    };
    trigger.addEventListener('click', () => options.hidden ? openPicker() : closePicker());
    trigger.addEventListener('keydown', event => {
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); openPicker(event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 : select.selectedIndex);
      }
    });
    options.addEventListener('keydown', event => {
      const index = choices.indexOf(document.activeElement);
      const offset = {ArrowDown: 1, ArrowUp: -1}[event.key];
      if (offset || event.key === 'Home' || event.key === 'End') {
        event.preventDefault(); focusChoice(event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 : index + offset);
      } else if (event.key === 'Escape') { event.preventDefault(); closePicker(true); }
    });
    picker.addEventListener('focusout', event => { if (!picker.contains(event.relatedTarget)) closePicker(); });
    document.addEventListener('pointerdown', event => { if (!picker.contains(event.target)) closePicker(); });
    picker.append(trigger, options); select.after(picker); select.hidden = true;
    categoryLabel.htmlFor = trigger.id;
    syncPicker();
  }

  const outsideClose = dialog => dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });

  // Headings originate in the real Markdown; both desktop and mobile use them.
  const body = $('#article-content');
  if (body) {
    const headings = $$('h2[id], h3[id]', body);
    const tocTargets = $$('[data-toc]');
    const cleanTitle = heading => [...heading.childNodes].filter(node => node.nodeType === Node.TEXT_NODE || !node.classList?.contains('anchor')).map(node => node.textContent).join('').trim();
    for (const target of tocTargets) {
      const list = document.createElement('ul'); list.className = 'toc-list';
      for (const heading of headings) {
        const item = document.createElement('li'); item.className = heading.tagName === 'H3' ? 'toc-subsection' : '';
        const link = document.createElement('a'); link.className = 'toc-link'; link.href = `#${encodeURIComponent(heading.id)}`; link.textContent = cleanTitle(heading); link.dataset.heading = heading.id;
        link.addEventListener('click', () => { const details = target.closest('details'); if (details) details.open = false; });
        item.append(link); list.append(item);
      }
      target.replaceChildren(list);
      target.closest('aside, details').hidden = headings.length === 0;
    }
    if (headings.length) {
      const links = $$('[data-heading]');
      const observer = new IntersectionObserver(entries => {
        const visible = entries.filter(entry => entry.isIntersecting);
        if (!visible.length) return;
        const id = visible[0].target.id;
        links.forEach(link => {
          const active = link.dataset.heading === id;
          link.classList.toggle('active', active);
          active ? link.setAttribute('aria-current', 'location') : link.removeAttribute('aria-current');
        });
      }, {rootMargin: '-90px 0px -65% 0px', threshold: 0});
      headings.forEach(heading => observer.observe(heading));
    }
  }

  // Chirpy's content transformer supplies the code/table markup, without its UI bundle.
  $$('.code-header > button').forEach(button => {
    button.type = 'button'; button.classList.add('code-copy'); button.textContent = '复制'; button.setAttribute('aria-label', '复制代码');
    button.addEventListener('click', async () => {
      const container = button.closest('[class*="language-"], .highlighter-rouge') || button.parentElement.parentElement;
      const code = $('.rouge-code', container) || $('.highlight code', container) || $('code', container);
      try {
        await navigator.clipboard.writeText(code?.textContent || '');
        button.textContent = '已复制'; button.setAttribute('aria-label', '代码已复制');
      } catch (_) { button.textContent = '请手动选中复制'; }
      setTimeout(() => { button.textContent = '复制'; button.setAttribute('aria-label', '复制代码'); }, 2200);
    });
  });
  $$('.anchor').forEach(link => { link.textContent = '#'; if (!link.getAttribute('aria-label')) link.setAttribute('aria-label', '链接到此标题'); });
  $$('img[data-src]').forEach(image => { image.src = image.dataset.src; image.removeAttribute('data-src'); });
  $$('a.img-link img').forEach(image => {
    const ready = () => image.closest('.shimmer')?.classList.remove('shimmer');
    image.complete ? ready() : image.addEventListener('load', ready, {once: true});
    image.addEventListener('error', ready, {once: true});
  });
  const imageDialog = $('#image-dialog');
  $$('a.img-link').forEach(link => link.addEventListener('click', event => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    let image = $('img', imageDialog);
    if (!image) { image = document.createElement('img'); imageDialog.append(image); }
    image.src = link.href; image.alt = $('img', link)?.alt || '文章插图';
    imageDialog.showModal();
  }));
  $('#close-image').addEventListener('click', () => imageDialog.close());
  outsideClose(imageDialog);

  const comments = $('#comments');
  if (comments) {
    const loadComments = () => {
      if (comments.dataset.loaded) return;
      comments.dataset.loaded = 'true';
      const script = document.createElement('script'); script.src = 'https://giscus.app/client.js'; script.async = true; script.crossOrigin = 'anonymous';
      const settings = {...comments.dataset, mapping: 'pathname', strict: '0', reactionsEnabled: '1', emitMetadata: '0', inputPosition: 'bottom', theme: 'light', lang: 'zh-CN', loading: 'lazy'};
      delete settings.loaded;
      for (const [key, value] of Object.entries(settings)) script.setAttribute(`data-${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`, value);
      script.addEventListener('error', () => {
        const link = document.createElement('a'); link.href = `https://github.com/${comments.dataset.repo}/discussions`; link.textContent = '打开 GitHub Discussions 留言'; comments.append(link);
      });
      comments.append(script);
    };
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { loadComments(); observer.disconnect(); } }, {rootMargin: '400px'});
    observer.observe(comments);
  }

  // Loading and voluntary replay have separate lifetimes; previews never delay entry.
  const intro = $('#intro'), character = $('.intro-character', intro);
  const background = [header, $('#main'), $('.site-footer'), $('.skip-link')].filter(Boolean);
  const sprite = new Image();
  sprite.src = `${base}/assets/img/capybara-sprint.webp`;
  const spriteReady = sprite.decode ? sprite.decode().catch(() => {}) : Promise.resolve();
  let introActive = false, introMode, introTimer, autoIntroDelay, lastFocus, exitAnimation, introCycle = 0;
  const finishIntro = () => {
    intro.hidden = true; intro.style.opacity = '';
    document.body.style.overflow = '';
    background.forEach(element => { element.inert = false; });
    const returnFocus = lastFocus?.isConnected && !intro.contains(lastFocus) && lastFocus !== document.body ? lastFocus : $('#main');
    returnFocus?.focus({preventScroll: true});
  };
  const closeIntro = () => {
    // A second click during the fade must not invalidate its cleanup callback.
    if (!introActive && !introMode) return;
    const closing = ++introCycle;
    introMode = null; clearTimeout(introTimer); clearTimeout(autoIntroDelay);
    if (location.hash === '#intro-preview' || location.hash === '#relax') history.replaceState(null, '', `${location.pathname}${location.search}`);
    if (!introActive) return;
    introActive = false;
    if (reduced.matches || !window.anime) { finishIntro(); return; }
    exitAnimation = window.anime.animate(intro, {opacity: [1, 0], duration: 420, ease: 'inOutQuad', onComplete: () => { if (closing === introCycle) finishIntro(); }});
  };
  const showIntro = async (duration = 0, mode = 'preview') => {
    const opening = ++introCycle;
    clearTimeout(introTimer); exitAnimation?.pause();
    if (mode !== 'loading') clearTimeout(autoIntroDelay);
    introMode = mode;
    await spriteReady;
    if (opening !== introCycle) return;
    if (imageDialog.open) {
      if (mode === 'loading') { introMode = null; return; }
      imageDialog.close();
    }
    if (!intro.contains(document.activeElement)) lastFocus = document.activeElement;
    introActive = true;
    background.forEach(element => { element.inert = true; });
    intro.hidden = false; intro.style.opacity = '1';
    document.body.style.overflow = 'hidden';
    // Reinsert the owned scene to restart its CSS frame cycle on replay.
    character.replaceChildren(character.firstElementChild.cloneNode(true));
    intro.focus({preventScroll: true});
    if (duration > 0) introTimer = setTimeout(closeIntro, duration);
  };
  intro.addEventListener('click', event => {
    if (!character.contains(event.target)) closeIntro();
  });
  intro.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeIntro();
    if (event.key === 'Tab') { event.preventDefault(); intro.focus(); }
  });
  const previewRequested = () => location.hash === '#relax' || location.hash === '#intro-preview';
  window.addEventListener('hashchange', () => {
    if (previewRequested()) showIntro();
    else if (introMode === 'preview') closeIntro();
  });
  if (previewRequested()) showIntro();
  if (!reduced.matches && !previewRequested()) {
    // Only initial/visible images belong to the page load; lazy images stay lazy.
    const images = $$('img', $('#main')).filter(image => {
      if (!image.currentSrc && !image.getAttribute('src')) return false;
      if (image.loading !== 'lazy') return true;
      const rect = image.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight;
    });
    const pageLoaded = document.readyState === 'complete' ? Promise.resolve() : new Promise(resolve => window.addEventListener('load', resolve, {once: true}));
    const decoded = Promise.allSettled([pageLoaded, ...images.map(image => image.decode ? image.decode() : Promise.resolve())]);
    autoIntroDelay = setTimeout(() => showIntro(8000, 'loading'), 100);
    decoded.finally(() => {
      clearTimeout(autoIntroDelay); if (introMode === 'loading') closeIntro();
      if (isHome) motion('.hero-copy > *', {opacity: [0, 1], y: [12, 0], duration: 650, delay: window.anime?.stagger(80), ease: 'outCubic'});
    });
  }

  // Keep native link navigation; cover real same-window page changes only.
  document.addEventListener('click', event => {
    if (reduced.matches || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest?.('a[href]');
    if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;
    const destination = new URL(link.href);
    if (!/^https?:$/.test(destination.protocol) || destination.origin !== location.origin) return;
    if (destination.pathname === location.pathname && destination.search === location.search) return;
    queueMicrotask(() => { if (!event.defaultPrevented) showIntro(8000, 'navigation'); });
  });

  // A cached document must not retain the outgoing navigation's overlay or locks.
  window.addEventListener('pageshow', event => {
    if (!event.persisted) return;
    ++introCycle; clearTimeout(introTimer); clearTimeout(autoIntroDelay); exitAnimation?.pause();
    introActive = false; introMode = null; finishIntro();
  });

  // Retire only the former worker at this blog's root, preserving other projects.
  const retireCache = async () => {
    if (!('serviceWorker' in navigator)) return;
    const scope = new URL(`${base}/`, location.origin).href;
    for (const registration of await navigator.serviceWorker.getRegistrations()) {
      const worker = registration.active || registration.waiting || registration.installing;
      if (registration.scope === scope && worker && new URL(worker.scriptURL).pathname === `${base}/sw.min.js`) await registration.unregister();
    }
    if (!('caches' in window)) return;
    const home = new URL(`${base}/`, location.origin).href, stylesheet = new URL(`${base}/assets/css/jekyll-theme-chirpy.css`, location.origin).href;
    for (const name of await caches.keys()) {
      if (!name.startsWith('chirpy-')) continue;
      const cache = await caches.open(name), keys = await cache.keys(), urls = new Set(keys.map(key => key.url));
      if (urls.has(home) && urls.has(stylesheet)) await caches.delete(name);
    }
  };
  retireCache().catch(() => {});
})();
