const crypto = require('crypto');

/**
 * Envolve handlers async para que rejeições cheguem ao error handler do Express.
 * (O Express 4 não captura automaticamente Promises rejeitadas.)
 */
function asyncHandler(fn) {
    return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

const onlyDigits = (value) => String(value || '').replace(/\D/g, '');

/**
 * Normaliza para o formato internacional usado pelo wa.me.
 * Assume Brasil (55) quando o número tem 10 ou 11 dígitos.
 */
function waNumber(value) {
    const digits = onlyDigits(value);
    if (digits.length === 10 || digits.length === 11) return `55${digits}`;
    return digits;
}

function waLink(value, message = '') {
    const number = waNumber(value);
    if (!number) return '';
    const query = message ? `?text=${encodeURIComponent(message)}` : '';
    return `https://wa.me/${number}${query}`;
}

/**
 * Formata números brasileiros para exibição: (83) 99804-4441
 */
function formatPhone(value) {
    const raw = onlyDigits(value);
    if (!raw) return '';

    const local = raw.length > 11 && raw.startsWith('55') ? raw.slice(2) : raw;

    if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
    if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
    return String(value);
}

function formatDate(value, options = {}) {
    if (!value) return '';
    // Datas "YYYY-MM-DD" são interpretadas como UTC; fixamos meio-dia para evitar
    // que o fuso horário jogue a data para o dia anterior.
    const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? new Date(`${value}T12:00:00`)
        : new Date(value);

    if (Number.isNaN(date.getTime())) return value;

    return new Intl.DateTimeFormat('pt-BR', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        ...options
    }).format(date).replace('.', '');
}

function formatDateTime(value) {
    if (!value) return '';
    const normalized = String(value).includes('T') || String(value).includes('-')
        ? String(value).replace(' ', 'T') + 'Z'
        : value;
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat('pt-BR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    }).format(date);
}

function truncate(value, max = 160) {
    const text = String(value || '').trim();
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function isValidDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
    const date = new Date(`${value}T12:00:00`);
    return !Number.isNaN(date.getTime()) && date.getTime() >= Date.now() - 24 * 60 * 60 * 1000;
}

function safeEqual(a, b) {
    const bufferA = Buffer.from(String(a || ''));
    const bufferB = Buffer.from(String(b || ''));
    if (bufferA.length !== bufferB.length) return false;
    return crypto.timingSafeEqual(bufferA, bufferB);
}

function newCsrfToken() {
    return crypto.randomBytes(24).toString('hex');
}

/** Status possíveis de um pedido e rótulos legíveis */
const BOOKING_STATUS = {
    pending: 'Aguardando',
    confirmed: 'Confirmado',
    cancelled: 'Cancelado'
};

/** Status possíveis de uma data na agenda */
const SCHEDULE_STATUS = {
    available: 'Disponível',
    reserved: 'Reservado',
    booked: 'Ocupado',
    unavailable: 'Indisponível'
};

module.exports = {
    asyncHandler,
    onlyDigits,
    waNumber,
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
};
