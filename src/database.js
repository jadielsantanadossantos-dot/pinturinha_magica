const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');

const dbPath = process.env.DB_PATH
    ? path.resolve(process.env.DB_PATH)
    : path.join(__dirname, '..', 'database', 'pinturinha.db');

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new sqlite3.Database(dbPath);

// ---- Wrappers em Promise -------------------------------------------------
const run = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
        err ? reject(err) : resolve(this);
    });
});

const get = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
});

const all = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
});

const exec = (sql) => new Promise((resolve, reject) => {
    db.exec(sql, (err) => err ? reject(err) : resolve());
});

// ---- Migrações incrementais ---------------------------------------------
async function ensureColumn(table, column, definition) {
    const columns = await all(`PRAGMA table_info(${table})`);
    if (!columns.some(c => c.name === column)) {
        await run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
}

// ---- Inicialização -------------------------------------------------------
const ready = (async () => {
    await run('PRAGMA journal_mode = WAL');
    await run('PRAGMA foreign_keys = ON');
    await run('PRAGMA busy_timeout = 5000');

    await exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password TEXT
        );

        CREATE TABLE IF NOT EXISTS gallery (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT,
            caption TEXT,
            category TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS bookings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            parent_name TEXT,
            contact TEXT,
            event_type TEXT,
            event_date TEXT,
            event_time TEXT,
            location TEXT,
            estimated_children INTEGER,
            observations TEXT,
            status TEXT DEFAULT 'pending',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS schedule (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT UNIQUE,
            status TEXT DEFAULT 'available',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            whatsapp TEXT,
            email TEXT
        );

        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            contact TEXT,
            message TEXT,
            is_read INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_gallery_category ON gallery(category);
        CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(event_date);
        CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
        CREATE INDEX IF NOT EXISTS idx_messages_read ON messages(is_read);
    `);

    // Colunas novas em bancos já existentes
    await ensureColumn('gallery', 'created_at', 'TEXT');
    await ensureColumn('bookings', 'created_at', 'TEXT');
    await ensureColumn('schedule', 'created_at', 'TEXT');
    await ensureColumn('settings', 'artist_name', "TEXT DEFAULT ''");
    await ensureColumn('settings', 'instagram', "TEXT DEFAULT ''");
    await ensureColumn('settings', 'hero_text', "TEXT DEFAULT ''");

    // Configurações iniciais (não sobrescreve o que já existe)
    await run(
        `INSERT OR IGNORE INTO settings (id, whatsapp, email, artist_name, instagram, hero_text)
         VALUES (1, ?, ?, ?, ?, ?)`,
        [
            process.env.DEFAULT_WHATSAPP || '5555000000000',
            process.env.DEFAULT_EMAIL || '',
            '',
            'pinturinhamagica',
            'Transformando sorrisos em cores'
        ]
    );

    // Usuário inicial (criado somente se ainda não existir)
    const initialUser = process.env.ADMIN_USER || 'Charlotte';
    const initialPass = process.env.ADMIN_PASSWORD || '123456';
    const existing = await get('SELECT id, password FROM users WHERE username = ?', [initialUser]);

    if (!existing) {
        await run('INSERT INTO users (username, password) VALUES (?, ?)', [
            initialUser,
            bcrypt.hashSync(initialPass, 10)
        ]);
        console.log(`[db] Usuário "${initialUser}" criado. Troque a senha inicial no painel.`);
        if (!process.env.ADMIN_PASSWORD) {
            console.warn('[db] AVISO: senha inicial padrão em uso. Defina ADMIN_PASSWORD ou troque pelo painel.');
        }
    } else if (!process.env.ADMIN_PASSWORD && bcrypt.compareSync(initialPass, existing.password)) {
        console.warn(`[db] AVISO: o usuário "${initialUser}" ainda usa a senha inicial. Troque em /admin#settings.`);
    }
})();

ready.catch((err) => {
    console.error('[db] Falha ao inicializar o banco:', err);
    process.exitCode = 1;
});

module.exports = {
    dbPath,
    ready,
    all,
    get,
    run,
    exec,
    // Compatibilidade com o formato antigo (prepare)
    prepare: (sql) => ({
        all: (params = [], callback) => db.all(sql, params, callback),
        get: (params = [], callback) => db.get(sql, params, callback),
        run: (params = [], callback) => db.run(sql, params, callback)
    })
};
