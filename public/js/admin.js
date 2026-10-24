(function () {
    'use strict';

    /* ---------- Abas do painel ---------- */
    const tabs = Array.from(document.querySelectorAll('.admin-tab'));
    const panels = Array.from(document.querySelectorAll('.admin-panel'));

    function activate(name, updateHash) {
        const target = tabs.find(function (tab) { return tab.dataset.tab === name; });
        if (!target) return false;

        tabs.forEach(function (tab) {
            const active = tab === target;
            tab.classList.toggle('is-active', active);
            tab.setAttribute('aria-selected', String(active));
        });

        panels.forEach(function (panel) {
            panel.classList.toggle('is-active', panel.dataset.panel === name);
        });

        if (updateHash) {
            history.replaceState(null, '', '#' + name);
        }

        return true;
    }

    if (tabs.length) {
        tabs.forEach(function (tab) {
            tab.addEventListener('click', function () {
                activate(tab.dataset.tab, true);
            });
        });

        const initial = window.location.hash.replace('#', '');
        if (!activate(initial, false)) activate('bookings', false);

        window.addEventListener('hashchange', function () {
            const name = window.location.hash.replace('#', '');
            if (name) activate(name, false);
        });
    }

    /* ---------- Confirmação antes de excluir ---------- */
    document.addEventListener('submit', function (event) {
        const form = event.target.closest('form[data-confirm]');
        if (!form) return;

        if (!window.confirm(form.dataset.confirm || 'Tem certeza?')) {
            event.preventDefault();
        }
    });

    /* ---------- Pré-visualização do upload ---------- */
    const fileInput = document.getElementById('photos');
    const preview = document.getElementById('upload-preview');

    if (fileInput && preview) {
        let urls = [];

        fileInput.addEventListener('change', function () {
            urls.forEach(function (url) { URL.revokeObjectURL(url); });
            urls = [];
            preview.innerHTML = '';

            Array.from(fileInput.files || []).slice(0, 10).forEach(function (file) {
                if (!file.type.startsWith('image/')) return;
                const url = URL.createObjectURL(file);
                urls.push(url);

                const image = document.createElement('img');
                image.src = url;
                image.alt = file.name;
                preview.appendChild(image);
            });
        });
    }

    /* ---------- Data mínima na agenda ---------- */
    const scheduleDate = document.getElementById('schedule-date');
    if (scheduleDate) {
        const now = new Date();
        const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
        scheduleDate.min = local.toISOString().slice(0, 10);
    }

    /* ---------- Diálogo de evento (criar / editar) ---------- */
    const eventDialog = document.getElementById('event-dialog');
    const openEventButton = document.querySelector('[data-open-event]');

    if (eventDialog && openEventButton) {
        const eventForm = document.getElementById('event-form');
        const eventDate = document.getElementById('event-date');
        const eventName = document.getElementById('event-name');
        const eventTitle = document.getElementById('event-dialog-title');
        const eventSubtitle = document.getElementById('event-dialog-subtitle');
        const eventSubmit = document.getElementById('event-dialog-submit');

        const fields = {
            name: eventName,
            contact: document.getElementById('event-contact'),
            type: document.getElementById('event-type'),
            status: document.getElementById('event-status'),
            date: eventDate,
            time: document.getElementById('event-time'),
            children: document.getElementById('event-children'),
            location: document.getElementById('event-location'),
            notes: document.getElementById('event-notes')
        };

        function today() {
            const now = new Date();
            const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
            return local.toISOString().slice(0, 10);
        }

        function showDialog() {
            if (typeof eventDialog.showModal === 'function') {
                eventDialog.showModal();
            } else {
                eventDialog.setAttribute('open', 'open');
            }

            if (eventName) eventName.focus();
        }

        function closeDialog() {
            if (typeof eventDialog.close === 'function') eventDialog.close();
            else eventDialog.removeAttribute('open');
        }

        function prepareCreate() {
            eventForm.reset();
            eventForm.action = '/admin/bookings/create';
            eventTitle.textContent = 'Adicionar evento';
            eventSubtitle.textContent = 'Cadastre um evento fechado por WhatsApp, telefone ou pessoalmente.';
            eventSubmit.textContent = 'Salvar evento';

            if (eventDate) eventDate.min = today();
            if (fields.type) fields.type.value = 'Aniversário';
            if (fields.status) fields.status.value = 'confirmed';
        }

        function openCreateDialog() {
            prepareCreate();
            showDialog();
        }

        function openEditDialog(button) {
            eventForm.reset();
            eventForm.action = '/admin/bookings/update/' + encodeURIComponent(button.dataset.id || '');
            eventTitle.textContent = 'Editar evento';
            eventSubtitle.textContent = 'Atualize os dados do evento. A agenda será ajustada automaticamente.';
            eventSubmit.textContent = 'Salvar alterações';

            const data = button.dataset;

            if (fields.name) fields.name.value = data.name || '';
            if (fields.contact) fields.contact.value = data.contact || '';
            if (fields.type) {
                const type = data.type || 'Outro';
                const hasType = Array.from(fields.type.options).some(function (option) {
                    return option.value === type;
                });
                fields.type.value = hasType ? type : 'Outro';
            }
            if (fields.status) fields.status.value = data.status === 'confirmed' ? 'confirmed' : 'pending';
            if (fields.time) fields.time.value = data.time || '';
            if (fields.children) fields.children.value = data.children || '';
            if (fields.location) fields.location.value = data.location || '';
            if (fields.notes) fields.notes.value = data.notes || '';

            if (fields.date) {
                fields.date.value = data.date || '';
                // Eventos antigos continuam editáveis sem alterar a data.
                fields.date.min = data.date && data.date < today() ? '' : today();
            }

            showDialog();
        }

        openEventButton.addEventListener('click', openCreateDialog);

        document.querySelectorAll('[data-edit-event]').forEach(function (button) {
            button.addEventListener('click', function () {
                openEditDialog(button);
            });
        });

        eventDialog.querySelectorAll('[data-close-event]').forEach(function (button) {
            button.addEventListener('click', closeDialog);
        });

        eventDialog.addEventListener('click', function (event) {
            if (event.target === eventDialog) closeDialog();
        });

        eventDialog.addEventListener('close', prepareCreate);
    }

    /* ---------- Fecha alertas automaticamente ---------- */
    document.querySelectorAll('.admin-alert--success, .admin-alert--info').forEach(function (alert) {
        setTimeout(function () {
            alert.style.transition = 'opacity .4s, transform .4s';
            alert.style.opacity = '0';
            alert.style.transform = 'translateY(-6px)';
            setTimeout(function () { alert.remove(); }, 400);
        }, 6000);
    });
})();
