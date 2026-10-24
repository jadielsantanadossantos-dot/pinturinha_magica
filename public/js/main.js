(function () {
    'use strict';

    /* ---------- Menu mobile ---------- */
    const toggle = document.querySelector('.nav-toggle');
    const nav = document.getElementById('site-nav');

    if (toggle && nav) {
        toggle.addEventListener('click', function () {
            const open = nav.classList.toggle('is-open');
            toggle.setAttribute('aria-expanded', String(open));
            toggle.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
        });

        nav.addEventListener('click', function (event) {
            if (event.target.closest('a')) {
                nav.classList.remove('is-open');
                toggle.setAttribute('aria-expanded', 'false');
                toggle.setAttribute('aria-label', 'Abrir menu');
            }
        });

        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') {
                nav.classList.remove('is-open');
                toggle.setAttribute('aria-expanded', 'false');
            }
        });
    }

    /* ---------- Reveal on scroll ---------- */
    const revealItems = document.querySelectorAll('.reveal');

    if ('IntersectionObserver' in window && revealItems.length) {
        const observer = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) {
                    entry.target.classList.add('is-visible');
                    observer.unobserve(entry.target);
                }
            });
        }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

        revealItems.forEach(function (item) { observer.observe(item); });
    } else {
        revealItems.forEach(function (item) { item.classList.add('is-visible'); });
    }

    /* ---------- Lightbox da galeria ---------- */
    const triggers = Array.from(document.querySelectorAll('[data-lightbox]'));
    const lightbox = document.getElementById('lightbox');

    if (!triggers.length || !lightbox) return;

    const image = document.getElementById('lightbox-image');
    const caption = document.getElementById('lightbox-caption');
    const category = document.getElementById('lightbox-category');
    let current = 0;

    function render(index) {
        current = (index + triggers.length) % triggers.length;
        const trigger = triggers[current];
        image.src = trigger.dataset.full;
        image.alt = trigger.dataset.caption || 'Pintura artística';
        caption.textContent = trigger.dataset.caption || '';
        category.textContent = trigger.dataset.category || 'Arte';
    }

    function open(index) {
        render(index);
        lightbox.hidden = false;
        document.body.style.overflow = 'hidden';
        const close = lightbox.querySelector('.lightbox-close');
        if (close) close.focus();
    }

    function close() {
        lightbox.hidden = true;
        document.body.style.overflow = '';
        const trigger = triggers[current];
        if (trigger) trigger.focus();
    }

    triggers.forEach(function (trigger, index) {
        trigger.addEventListener('click', function () { open(index); });
    });

    lightbox.querySelectorAll('[data-lightbox-close]').forEach(function (el) {
        el.addEventListener('click', close);
    });

    const prev = lightbox.querySelector('[data-lightbox-prev]');
    const next = lightbox.querySelector('[data-lightbox-next]');

    if (prev) prev.addEventListener('click', function () { render(current - 1); });
    if (next) next.addEventListener('click', function () { render(current + 1); });

    document.addEventListener('keydown', function (event) {
        if (lightbox.hidden) return;

        if (event.key === 'Escape') close();
        if (event.key === 'ArrowLeft') render(current - 1);
        if (event.key === 'ArrowRight') render(current + 1);
    });
})();
