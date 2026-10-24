require('dotenv').config();

const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const bcrypt = require('bcrypt');

const db = require('./database');
const {
    asyncHandler,
    onlyDigits,
    waLink,
    formatPhone,
    formatDate,
    formatDateTime,
    truncate,
    isValidDate,
    safeEqual,
    newCsrfToken,
    BOOKING_STATUS,
    SCHEDULE_STATUS
} = require('./utils');

const app = express();
const port = Number(process.env.PORT) || (process.env.NODE_ENV === 'production' ? 80 : 3000);
const rootDir = path.join(__dirname, '..');
const uploadsDir = process.env.UPLOADS_DIR
    ? path.resolve(process.env.UPLOADS_DIR)
    : path.join(rootDir, 'uploads');

fs.mkdirSync(uploadsDir, { recursive: true });

const GALLERY_CATEGORIES = ['Aniversário', 'Escolar', 'Festival', 'Corporativo', 'Outro'];

// --- Configuração base ----------------------------------------------------
app.disable('x-powered-by');
if (process.env.NODE_ENV === 'production') {
    // Necessário para cookies "secure" atrás do proxy HTTPS do Shard Cloud.
    app.set('trust proxy', 1);
}
app.set('view engine', 'ejs');
app.set('views', path.join(rootDir, 'views'));

app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
});

app.use(express.static(path.join(rootDir, 'public')));
app.use('/uploads', express.static(uploadsDir, {
    maxAge: '30d',
    setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff')
}));
app.use('/uploads', (req, res) => res.status(404).end());

app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));

const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) {
    console.warn('[app] AVISO: SESSION_SECRET não definido. Usando segredo temporário (sessões caem ao reiniciar).');
}

app.use(session({
    name: 'pinturinha.sid',
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 1000 * 60 * 60 * 8
    }
}));

// --- Locals / helpers -----------------------------------------------------
app.use((req, res, next) => {
    res.locals.currentPath = req.path;
    res.locals.currentUser = req.session.user || null;
    res.locals.flash = req.session.flash || null;
    delete req.session.flash;

    res.locals.formatDate = formatDate;
    res.locals.formatDateTime = formatDateTime;
    res.locals.formatPhone = formatPhone;
    res.locals.waLink = waLink;
    res.locals.truncate = truncate;
    res.locals.bookingStatus = BOOKING_STATUS;
    res.locals.scheduleStatus = SCHEDULE_STATUS;
    res.locals.year = new Date().getFullYear();

    if (!req.session.csrfToken) req.session.csrfToken = newCsrfToken();
    res.locals.csrfToken = req.session.csrfToken;

    next();
});

// Configurações do site disponíveis em TODAS as páginas (antes das rotas).
app.use(asyncHandler(async (req, res, next) => {
    const site = await db.get('SELECT * FROM settings WHERE id = 1');
    res.locals.site = site || {};
    res.locals.waHref = waLink(site && site.whatsapp);
    res.locals.waDisplay = formatPhone(site && site.whatsapp);
    next();
}));

const flash = (req, type, message) => {
    req.session.flash = { type, message };
};

// --- Uploads --------------------------------------------------------------
const ALLOWED_MIME = /^image\/(jpeg|png|webp|gif)$/;

const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, uploadsDir),
        filename: (req, file, cb) => {
            const ext = path.extname(file.originalname).toLowerCase();
            const safeExt = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext) ? ext : '';
            cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${safeExt}`);
        }
    }),
    limits: { fileSize: 8 * 1024 * 1024, files: 10 },
    fileFilter: (req, file, cb) => {
        if (!ALLOWED_MIME.test(file.mimetype)) {
            return cb(new Error('Envie apenas imagens JPG, PNG, WEBP ou GIF.'));
        }
        cb(null, true);
    }
});

function galleryUpload(req, res, next) {
    upload.array('photos', 10)(req, res, (err) => {
        if (!err) return next();
        req.session.flash = {
            type: 'error',
            message: err.code === 'LIMIT_FILE_SIZE'
                ? 'Cada imagem deve ter no máximo 8 MB.'
                : err.message
        };
        res.redirect('/admin#gallery');
    });
}

function removeUploadedFile(filename) {
    if (!filename) return;
    const target = path.join(uploadsDir, path.basename(filename));
    if (!target.startsWith(uploadsDir)) return;
    fs.promises.unlink(target).catch(() => {});
}

// --- Autenticação ---------------------------------------------------------
function isAuthenticated(req, res, next) {
    if (req.session.user) return next();
    req.session.flash = { type: 'info', message: 'Faça login para acessar o painel.' };
    res.redirect('/admin/login');
}

const loginAttempts = new Map();
const LOGIN_WINDOW = 15 * 60 * 1000;
const LOGIN_MAX = 8;

function loginLimiter(req, res, next) {
    const key = req.ip || 'desconhecido';
    const record = loginAttempts.get(key);

    if (record && Date.now() - record.first > LOGIN_WINDOW) {
        loginAttempts.delete(key);
    }

    const current = loginAttempts.get(key);
    if (current && current.count >= LOGIN_MAX) {
        return res.status(429).render('admin/login', {
            error: 'Muitas tentativas de login. Aguarde alguns minutos e tente novamente.',
            username: ''
        });
    }

    next();
}

function registerLoginFailure(req) {
    const key = req.ip || 'desconhecido';
    const record = loginAttempts.get(key) || { count: 0, first: Date.now() };
    record.count += 1;
    loginAttempts.set(key, record);
}

function verifyCsrf(req, res, next) {
    if (safeEqual(req.body && req.body._csrf, req.session.csrfToken)) return next();

    res.status(403);
    return res.render('erro', {
        statusCode: 403,
        pageTitle: 'Sessão expirada',
        message: 'Sua sessão expirou ou o formulário é inválido. Recarregue a página e tente novamente.'
    });
}

setInterval(() => {
    const cutoff = Date.now() - LOGIN_WINDOW;
    for (const [key, record] of loginAttempts) {
        if (record.first < cutoff) loginAttempts.delete(key);
    }
}, LOGIN_WINDOW).unref();

// --- Rotas públicas -------------------------------------------------------
app.get('/', asyncHandler(async (req, res) => {
    const photos = await db.all('SELECT * FROM gallery ORDER BY id DESC LIMIT 6');
    res.render('index', {
        pageTitle: 'Pintura corporal artística infantil',
        photos,
        heroPhotos: photos.slice(0, 3)
    });
}));

app.get('/sobre', (req, res) => {
    res.render('sobre', { pageTitle: 'Sobre' });
});

app.get('/galeria', asyncHandler(async (req, res) => {
    const category = typeof req.query.category === 'string' ? req.query.category.trim() : '';
    const categories = await db.all(
        "SELECT DISTINCT category FROM gallery WHERE category IS NOT NULL AND category != '' ORDER BY category"
    );

    const photos = category && categories.some(c => c.category === category)
        ? await db.all('SELECT * FROM gallery WHERE category = ? ORDER BY id DESC', [category])
        : await db.all('SELECT * FROM gallery ORDER BY id DESC');

    res.render('galeria', {
        pageTitle: 'Galeria',
        photos,
        categories: categories.map(c => c.category),
        selectedCategory: category
    });
}));

app.get('/contato', (req, res) => {
    res.render('contato', {
        pageTitle: 'Contato',
        form: {},
        errors: [],
        message: null
    });
});

app.post('/contato', asyncHandler(async (req, res) => {
    const form = {
        name: String(req.body.name || '').trim().slice(0, 120),
        contact: String(req.body.contact || '').trim().slice(0, 120),
        message: String(req.body.message || '').trim().slice(0, 2000)
    };

    const errors = [];
    if (form.name.length < 2) errors.push('Informe seu nome.');
    if (form.contact.length < 5) errors.push('Informe um e-mail ou telefone para contato.');
    if (form.message.length < 10) errors.push('Escreva uma mensagem com pelo menos 10 caracteres.');

    if (errors.length) {
        return res.status(422).render('contato', { pageTitle: 'Contato', form, errors, message: null });
    }

    await db.run('INSERT INTO messages (name, contact, message, created_at) VALUES (?, ?, ?, datetime(\'now\'))', [
        form.name, form.contact, form.message
    ]);

    res.render('contato', {
        pageTitle: 'Contato',
        form: {},
        errors: [],
        message: 'Mensagem enviada! Vamos responder o mais breve possível. 💌'
    });
}));

app.get('/orcamento', asyncHandler(async (req, res) => {
    const schedule = await db.all(
        "SELECT * FROM schedule WHERE status != 'available' AND date >= date('now') ORDER BY date ASC"
    );

    res.render('orcamento', {
        pageTitle: 'Orçamento',
        schedule,
        form: {},
        errors: [],
        message: null
    });
}));

app.post('/orcamento', asyncHandler(async (req, res) => {
    const fields = ['parent_name', 'contact', 'event_type', 'event_date', 'event_time',
        'address', 'number', 'complement', 'reference', 'estimated_children', 'observations'];

    const form = {};
    for (const field of fields) {
        form[field] = String(req.body[field] || '').trim().slice(0, 500);
    }

    const errors = [];
    if (form.parent_name.length < 3) errors.push('Informe o nome completo do responsável.');
    if (onlyDigits(form.contact).length < 10) errors.push('Informe um WhatsApp ou telefone válido com DDD.');
    if (!isValidDate(form.event_date)) errors.push('Escolha uma data válida, a partir de hoje.');
    if (!form.address) errors.push('Informe o endereço do evento.');
    if (!form.number) errors.push('Informe o número do endereço.');

    const children = form.estimated_children ? Number.parseInt(form.estimated_children, 10) : null;
    if (form.estimated_children && (!Number.isFinite(children) || children < 1 || children > 500)) {
        errors.push('Informe uma quantidade estimada de crianças entre 1 e 500.');
    }

    const loadSchedule = () => db.all(
        "SELECT * FROM schedule WHERE status != 'available' AND date >= date('now') ORDER BY date ASC"
    );

    if (!errors.length) {
        const conflict = await db.get(
            "SELECT * FROM schedule WHERE date = ? AND status != 'available'",
            [form.event_date]
        );
        if (conflict) {
            errors.push('Essa data já está reservada ou indisponível. Escolha outra data ou fale com a gente no WhatsApp.');
        }
    }

    if (errors.length) {
        return res.status(422).render('orcamento', {
            pageTitle: 'Orçamento',
            schedule: await loadSchedule(),
            form,
            errors,
            message: null
        });
    }

    const location = `${form.address}, ${form.number}`
        + (form.complement ? ` - ${form.complement}` : '')
        + (form.reference ? ` (Ref: ${form.reference})` : '');

    await db.run(`
        INSERT INTO bookings
            (parent_name, contact, event_type, event_date, event_time, location,
             estimated_children, observations, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now'))
    `, [
        form.parent_name, form.contact, form.event_type, form.event_date, form.event_time,
        location, children, form.observations
    ]);

    // Reserva a data provisoriamente para evitar dois pedidos para o mesmo dia.
    await db.run("INSERT OR IGNORE INTO schedule (date, status, created_at) VALUES (?, 'reserved', datetime('now'))", [form.event_date]);
    await db.run("UPDATE schedule SET status = 'reserved' WHERE date = ? AND status = 'available'", [form.event_date]);

    res.render('orcamento', {
        pageTitle: 'Orçamento',
        schedule: await loadSchedule(),
        form: {},
        errors: [],
        message: 'Pedido enviado com sucesso! A data ficou reservada provisoriamente e vamos confirmar pelo WhatsApp. 🎨'
    });
}));

// --- Rotas de acesso ------------------------------------------------------
app.get('/admin/login', (req, res) => {
    if (req.session.user) return res.redirect('/admin');
    res.render('admin/login', { error: null, username: '', layout: 'admin' });
});

app.post('/admin/login', loginLimiter, asyncHandler(async (req, res) => {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');

    const user = await db.get('SELECT * FROM users WHERE username = ? COLLATE NOCASE', [username]);

    if (!user || !bcrypt.compareSync(password, user.password)) {
        registerLoginFailure(req);
        return res.status(401).render('admin/login', {
            error: 'Usuário ou senha inválidos.',
            username,
            layout: 'admin'
        });
    }

    loginAttempts.delete(req.ip || 'desconhecido');

    // Regenera a sessão para evitar fixation
    await new Promise((resolve, reject) => {
        req.session.regenerate((err) => err ? reject(err) : resolve());
    });

    req.session.user = { id: user.id, username: user.username };
    req.session.csrfToken = newCsrfToken();
    req.session.flash = { type: 'success', message: `Bem-vindo(a), ${user.username}!` };

    res.redirect('/admin');
}));

app.post('/admin/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/'));
});

// Compatibilidade com links antigos de logout
app.get('/admin/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/'));
});

// --- Painel administrativo ------------------------------------------------
app.get('/admin', isAuthenticated, asyncHandler(async (req, res) => {
    const [bookings, photos, schedule, messages, stats] = await Promise.all([
        db.all(`SELECT * FROM bookings
                ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'confirmed' THEN 1 ELSE 2 END,
                         event_date ASC`),
        db.all('SELECT * FROM gallery ORDER BY id DESC'),
        db.all('SELECT * FROM schedule ORDER BY date ASC'),
        db.all('SELECT * FROM messages ORDER BY is_read ASC, id DESC'),
        db.get(`SELECT
                    (SELECT COUNT(*) FROM bookings WHERE status = 'pending') AS pending_bookings,
                    (SELECT COUNT(*) FROM messages WHERE is_read = 0) AS unread_messages,
                    (SELECT COUNT(*) FROM gallery) AS total_photos,
                    (SELECT COUNT(*) FROM schedule WHERE status IN ('booked', 'unavailable') AND date >= date('now')) AS busy_dates
                `)
    ]);

    res.render('admin/dashboard', {
        pageTitle: 'Painel',
        bookings,
        photos,
        schedule,
        messages,
        stats,
        categories: GALLERY_CATEGORIES
    });
}));

// Pedidos
app.post('/admin/bookings/status/:id', isAuthenticated, verifyCsrf, asyncHandler(async (req, res) => {
    const status = String(req.body.status || '');
    if (!BOOKING_STATUS[status]) {
        flash(req, 'error', 'Status inválido.');
        return res.redirect('/admin#bookings');
    }

    const booking = await db.get('SELECT * FROM bookings WHERE id = ?', [req.params.id]);
    if (!booking) {
        flash(req, 'error', 'Pedido não encontrado.');
        return res.redirect('/admin#bookings');
    }

    await db.run('UPDATE bookings SET status = ? WHERE id = ?', [status, booking.id]);

    if (status === 'confirmed') {
        await db.run("INSERT OR IGNORE INTO schedule (date, status, created_at) VALUES (?, 'booked', datetime('now'))", [booking.event_date]);
        await db.run("UPDATE schedule SET status = 'booked' WHERE date = ?", [booking.event_date]);
        flash(req, 'success', `Pedido de ${booking.parent_name} confirmado e movido para a Agenda.`);
    } else if (status === 'cancelled') {
        await db.run(
            "UPDATE schedule SET status = 'available' WHERE date = ? AND status IN ('reserved', 'booked')",
            [booking.event_date]
        );
        flash(req, 'info', 'Pedido cancelado e data liberada na agenda.');
    } else {
        await db.run(
            "INSERT OR IGNORE INTO schedule (date, status, created_at) VALUES (?, 'reserved', datetime('now'))",
            [booking.event_date]
        );
        flash(req, 'success', 'Pedido marcado como aguardando confirmação.');
    }

    res.redirect('/admin#bookings');
}));

app.post('/admin/bookings/delete/:id', isAuthenticated, verifyCsrf, asyncHandler(async (req, res) => {
    const booking = await db.get('SELECT * FROM bookings WHERE id = ?', [req.params.id]);
    if (booking) {
        await db.run('DELETE FROM bookings WHERE id = ?', [booking.id]);
        if (booking.status !== 'confirmed') {
            await db.run(
                "UPDATE schedule SET status = 'available' WHERE date = ? AND status = 'reserved'",
                [booking.event_date]
            );
        }
    }
    flash(req, 'info', 'Pedido removido.');
    res.redirect('/admin#bookings');
}));

// Galeria
app.post('/admin/gallery/add', isAuthenticated, galleryUpload, verifyCsrf, asyncHandler(async (req, res) => {
    const files = req.files || [];
    if (!files.length) {
        flash(req, 'error', 'Selecione pelo menos uma imagem.');
        return res.redirect('/admin#gallery');
    }

    const caption = String(req.body.caption || '').trim().slice(0, 200) || 'Pintura artística';
    const category = GALLERY_CATEGORIES.includes(req.body.category) ? req.body.category : 'Outro';

    try {
        for (const file of files) {
            await db.run(
                "INSERT INTO gallery (filename, caption, category, created_at) VALUES (?, ?, ?, datetime('now'))",
                [file.filename, caption, category]
            );
        }
        flash(req, 'success', `${files.length} foto(s) adicionada(s) à galeria.`);
    } catch (err) {
        files.forEach(file => removeUploadedFile(file.filename));
        throw err;
    }

    res.redirect('/admin#gallery');
}));

app.post('/admin/gallery/delete/:id', isAuthenticated, verifyCsrf, asyncHandler(async (req, res) => {
    const photo = await db.get('SELECT * FROM gallery WHERE id = ?', [req.params.id]);
    if (photo) {
        await db.run('DELETE FROM gallery WHERE id = ?', [photo.id]);
        removeUploadedFile(photo.filename);
        flash(req, 'info', 'Foto removida da galeria.');
    }
    res.redirect('/admin#gallery');
}));

// Cadastro manual de evento pelo painel
app.post('/admin/bookings/create', isAuthenticated, verifyCsrf, asyncHandler(async (req, res) => {
    const form = {
        parent_name: String(req.body.parent_name || '').trim().slice(0, 120),
        contact: String(req.body.contact || '').trim().slice(0, 120),
        event_type: String(req.body.event_type || 'Outro').trim().slice(0, 80),
        event_date: String(req.body.event_date || '').trim(),
        event_time: String(req.body.event_time || '').trim().slice(0, 10),
        location: String(req.body.location || '').trim().slice(0, 300),
        estimated_children: String(req.body.estimated_children || '').trim(),
        observations: String(req.body.observations || '').trim().slice(0, 1000),
        status: ['pending', 'confirmed'].includes(req.body.status) ? req.body.status : 'confirmed'
    };

    const errors = [];
    if (form.parent_name.length < 3) errors.push('Informe o nome do cliente/responsável.');
    if (!isValidDate(form.event_date)) errors.push('Informe uma data válida, a partir de hoje.');

    let children = null;
    if (form.estimated_children) {
        children = Number.parseInt(form.estimated_children, 10);
        if (!Number.isFinite(children) || children < 1 || children > 500) {
            errors.push('A quantidade de crianças deve ficar entre 1 e 500.');
        }
    }

    if (errors.length) {
        flash(req, 'error', errors[0]);
        return res.redirect('/admin#schedule');
    }

    const conflict = await db.get(
        "SELECT * FROM schedule WHERE date = ? AND status IN ('reserved', 'booked', 'unavailable')",
        [form.event_date]
    );

    if (conflict) {
        flash(req, 'error',
            `A data ${formatDate(form.event_date)} já está ${String(SCHEDULE_STATUS[conflict.status] || conflict.status).toLowerCase()} na agenda. ` +
            'Remova o bloqueio ou escolha outra data.'
        );
        return res.redirect('/admin#schedule');
    }

    await db.run(`
        INSERT INTO bookings
            (parent_name, contact, event_type, event_date, event_time, location,
             estimated_children, observations, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `, [
        form.parent_name, form.contact, form.event_type, form.event_date, form.event_time,
        form.location, children, form.observations, form.status
    ]);

    const newScheduleStatus = form.status === 'confirmed' ? 'booked' : 'reserved';
    await db.run(
        "INSERT OR IGNORE INTO schedule (date, status, created_at) VALUES (?, ?, datetime('now'))",
        [form.event_date, newScheduleStatus]
    );
    await db.run('UPDATE schedule SET status = ? WHERE date = ?', [newScheduleStatus, form.event_date]);

    flash(req, 'success', `Evento de ${form.parent_name} adicionado em ${formatDate(form.event_date)}.`);
    res.redirect('/admin#schedule');
}));

// Edição de evento pelo painel
app.post('/admin/bookings/update/:id', isAuthenticated, verifyCsrf, asyncHandler(async (req, res) => {
    const booking = await db.get('SELECT * FROM bookings WHERE id = ?', [req.params.id]);
    if (!booking) {
        flash(req, 'error', 'Evento não encontrado.');
        return res.redirect('/admin#schedule');
    }

    if (booking.status === 'cancelled') {
        flash(req, 'error', 'Este evento está cancelado. Reative-o em Pedidos antes de editar.');
        return res.redirect('/admin#schedule');
    }

    const form = {
        parent_name: String(req.body.parent_name || '').trim().slice(0, 120),
        contact: String(req.body.contact || '').trim().slice(0, 120),
        event_type: String(req.body.event_type || 'Outro').trim().slice(0, 80),
        event_date: String(req.body.event_date || '').trim(),
        event_time: String(req.body.event_time || '').trim().slice(0, 10),
        location: String(req.body.location || '').trim().slice(0, 300),
        estimated_children: String(req.body.estimated_children || '').trim(),
        observations: String(req.body.observations || '').trim().slice(0, 1000),
        status: ['pending', 'confirmed'].includes(req.body.status) ? req.body.status : booking.status
    };

    const dateUnchanged = form.event_date === booking.event_date;
    const errors = [];

    if (form.parent_name.length < 3) errors.push('Informe o nome do cliente/responsável.');
    if (!isValidDate(form.event_date) && !dateUnchanged) {
        errors.push('Informe uma data válida, a partir de hoje.');
    }

    let children = null;
    if (form.estimated_children) {
        children = Number.parseInt(form.estimated_children, 10);
        if (!Number.isFinite(children) || children < 1 || children > 500) {
            errors.push('A quantidade de crianças deve ficar entre 1 e 500.');
        }
    }

    if (errors.length) {
        flash(req, 'error', errors[0]);
        return res.redirect('/admin#schedule');
    }

    if (!dateUnchanged) {
        const conflict = await db.get(
            "SELECT * FROM schedule WHERE date = ? AND status IN ('reserved', 'booked', 'unavailable')",
            [form.event_date]
        );

        if (conflict) {
            flash(req, 'error',
                `A data ${formatDate(form.event_date)} já está ${String(SCHEDULE_STATUS[conflict.status] || conflict.status).toLowerCase()} na agenda. ` +
                'Escolha outra data.'
            );
            return res.redirect('/admin#schedule');
        }
    }

    await db.run(`
        UPDATE bookings
        SET parent_name = ?, contact = ?, event_type = ?, event_date = ?, event_time = ?,
            location = ?, estimated_children = ?, observations = ?, status = ?
        WHERE id = ?
    `, [
        form.parent_name, form.contact, form.event_type, form.event_date, form.event_time,
        form.location, children, form.observations, form.status, booking.id
    ]);

    if (!dateUnchanged) {
        await db.run(
            "UPDATE schedule SET status = 'available' WHERE date = ? AND status IN ('reserved', 'booked')",
            [booking.event_date]
        );
    }

    const newScheduleStatus = form.status === 'confirmed' ? 'booked' : 'reserved';
    await db.run(
        "INSERT OR IGNORE INTO schedule (date, status, created_at) VALUES (?, ?, datetime('now'))",
        [form.event_date, newScheduleStatus]
    );
    await db.run('UPDATE schedule SET status = ? WHERE date = ?', [newScheduleStatus, form.event_date]);

    flash(req, 'success', `Evento de ${form.parent_name} atualizado.`);
    res.redirect('/admin#schedule');
}));

// Agenda
app.post('/admin/schedule/add', isAuthenticated, verifyCsrf, asyncHandler(async (req, res) => {
    const date = String(req.body.date || '').trim();
    const status = SCHEDULE_STATUS[req.body.status] ? req.body.status : 'unavailable';

    if (!isValidDate(date)) {
        flash(req, 'error', 'Informe uma data válida (a partir de hoje).');
        return res.redirect('/admin#schedule');
    }

    await db.run("INSERT OR IGNORE INTO schedule (date, status, created_at) VALUES (?, ?, datetime('now'))", [date, status]);
    await db.run('UPDATE schedule SET status = ? WHERE date = ?', [status, date]);

    flash(req, 'success', `Agenda atualizada: ${formatDate(date)} — ${SCHEDULE_STATUS[status]}.`);
    res.redirect('/admin#schedule');
}));

app.post('/admin/schedule/delete/:id', isAuthenticated, verifyCsrf, asyncHandler(async (req, res) => {
    await db.run('DELETE FROM schedule WHERE id = ?', [req.params.id]);
    flash(req, 'info', 'Data removida da agenda.');
    res.redirect('/admin#schedule');
}));

// Mensagens
app.post('/admin/messages/:id/read', isAuthenticated, verifyCsrf, asyncHandler(async (req, res) => {
    await db.run('UPDATE messages SET is_read = 1 WHERE id = ?', [req.params.id]);
    res.redirect('/admin#messages');
}));

app.post('/admin/messages/:id/delete', isAuthenticated, verifyCsrf, asyncHandler(async (req, res) => {
    await db.run('DELETE FROM messages WHERE id = ?', [req.params.id]);
    flash(req, 'info', 'Mensagem removida.');
    res.redirect('/admin#messages');
}));

// Configurações
app.post('/admin/settings/update', isAuthenticated, verifyCsrf, asyncHandler(async (req, res) => {
    const whatsapp = String(req.body.whatsapp || '').trim().slice(0, 30);
    const email = String(req.body.email || '').trim().slice(0, 160);
    const instagram = String(req.body.instagram || '').trim().replace(/^@/, '').slice(0, 80);
    const artistName = String(req.body.artist_name || '').trim().slice(0, 120);
    const heroText = String(req.body.hero_text || '').trim().slice(0, 200);

    if (whatsapp && onlyDigits(whatsapp).length < 10) {
        flash(req, 'error', 'WhatsApp inválido. Use DDD + número, por exemplo 83999998888.');
        return res.redirect('/admin#settings');
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        flash(req, 'error', 'E-mail inválido.');
        return res.redirect('/admin#settings');
    }

    await db.run(
        `UPDATE settings
         SET whatsapp = ?, email = ?, instagram = ?, artist_name = ?, hero_text = ?
         WHERE id = 1`,
        [whatsapp, email, instagram, artistName, heroText]
    );

    flash(req, 'success', 'Configurações salvas.');
    res.redirect('/admin#settings');
}));

app.post('/admin/password', isAuthenticated, verifyCsrf, asyncHandler(async (req, res) => {
    const current = String(req.body.current_password || '');
    const next = String(req.body.new_password || '');
    const confirm = String(req.body.confirm_password || '');

    const user = await db.get('SELECT * FROM users WHERE id = ?', [req.session.user.id]);

    if (!user || !bcrypt.compareSync(current, user.password)) {
        flash(req, 'error', 'A senha atual está incorreta.');
        return res.redirect('/admin#settings');
    }

    if (next.length < 8) {
        flash(req, 'error', 'A nova senha precisa ter pelo menos 8 caracteres.');
        return res.redirect('/admin#settings');
    }

    if (next !== confirm) {
        flash(req, 'error', 'A confirmação da nova senha não confere.');
        return res.redirect('/admin#settings');
    }

    await db.run('UPDATE users SET password = ? WHERE id = ?', [
        bcrypt.hashSync(next, 10),
        user.id
    ]);

    flash(req, 'success', 'Senha alterada com sucesso.');
    res.redirect('/admin#settings');
}));

// --- 404 e erros ----------------------------------------------------------
function ensureLayoutLocals(res) {
    res.locals.site = res.locals.site || {};
    res.locals.waHref = res.locals.waHref || '';
    res.locals.waDisplay = res.locals.waDisplay || '';
    res.locals.year = res.locals.year || new Date().getFullYear();
    res.locals.currentPath = res.locals.currentPath || '';
}

app.use((req, res) => {
    ensureLayoutLocals(res);
    res.status(404).render('404', { pageTitle: 'Página não encontrada' });
});

app.use((err, req, res, next) => {
    console.error('[app] Erro:', err);

    if (res.headersSent) return next(err);

    ensureLayoutLocals(res);

    const statusCode = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
    res.status(statusCode).render('erro', {
        pageTitle: statusCode === 404 ? 'Página não encontrada' : 'Algo deu errado',
        statusCode,
        message: statusCode === 500
            ? 'Tivemos um problema inesperado. Tente novamente em instantes.'
            : err.message
    });
});

// --- Start ----------------------------------------------------------------
db.ready
    .then(() => {
        app.listen(port, () => {
            console.log(`✨ Pinturinha Mágica rodando em http://localhost:${port}`);
            console.log(`   Banco: ${db.dbPath}`);
        });
    })
    .catch((err) => {
        console.error('Não foi possível inicializar o banco de dados:', err);
        process.exit(1);
    });

module.exports = app;
