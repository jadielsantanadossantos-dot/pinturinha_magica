# Pinturinha Mágica

Site e painel administrativo para serviço de pintura corporal artística infantil.

## Stack

- Node.js + Express 4
- EJS
- SQLite 3
- Sessões com `express-session` + `bcrypt`
- Upload de fotos com `multer`

## Como rodar

```bash
# instalar dependências (se necessário)
npm install

# copiar as variáveis de ambiente
copy .env.example .env     # Windows
# cp .env.example .env     # Linux/macOS

# gerar um segredo de sessão
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# cole o valor em SESSION_SECRET no .env

npm run dev   # com nodemon
# ou
npm start
```

O site fica em `http://localhost:3000` e o painel em `http://localhost:3000/admin`.

> Na primeira execução o banco é criado/migrado automaticamente em `database/pinturinha.db`.

## Acesso ao painel

O usuário inicial é `Charlotte` com a senha `123456` (ou o que estiver em `ADMIN_USER` / `ADMIN_PASSWORD` no `.env`, usado somente quando o usuário ainda não existe).

**Troque a senha em Configurações → Segurança no primeiro acesso.**

## Variáveis de ambiente

| Variável | Padrão | Descrição |
|---|---|---|
| `PORT` | `3000` | Porta do servidor (em produção sem `PORT`, usa `80`) |
| `NODE_ENV` | `development` | Em `production`, ativa cookies seguros e confiança no proxy HTTPS |
| `SESSION_SECRET` | aleatório | Segredo das sessões (defina para manter o login entre reinícios) |
| `ADMIN_USER` | `Charlotte` | Usuário criado no primeiro start |
| `ADMIN_PASSWORD` | `123456` | Senha inicial do usuário criado no primeiro start |
| `DB_PATH` | `database/pinturinha.db` | Caminho do banco |
| `UPLOADS_DIR` | `uploads/` | Pasta das fotos enviadas pelo painel |
| `DEFAULT_WHATSAPP` | `5555000000000` | WhatsApp inicial do site |
| `DEFAULT_EMAIL` | vazio | E-mail inicial do site |

## Estrutura

```
index.js      entrada do Shard Cloud (inicia src/app.js)
src/
  app.js        rotas públicas e do painel
  database.js   conexão, criação/migração das tabelas e seed
  utils.js      helpers (datas, telefone, CSRF, async handler)
views/
  partials/     head, header e footer compartilhados
  admin/        login e dashboard
public/
  css/          style.css (site) e admin.css (painel)
  js/           main.js (menu, lightbox) e admin.js (abas, confirmações)
uploads/        imagens enviadas pelo painel
database/       arquivo SQLite
.shardcloud     configuração de deploy no Shard Cloud
```

## O que o painel permite

- Ver e atualizar pedidos de orçamento (aguardando / confirmado / cancelado)
- Abrir conversa no WhatsApp com o cliente direto pelo pedido
- Pedidos confirmados saem da aba Pedidos e passam a aparecer na Agenda
- Gerenciar a agenda (disponível, reservado, ocupado, indisponível)
- Cadastrar eventos manualmente pela Agenda (cliente, data, local e status)
- Editar eventos e remarcar a data pela Agenda
- Subir e remover fotos da galeria (até 10 por vez, 8 MB cada)
- Ler e excluir mensagens do formulário de contato
- Editar WhatsApp, e-mail, Instagram, nome da artista e frase da home
- Trocar a senha

Ao confirmar um pedido, a data é marcada como ocupada automaticamente. Ao cancelar, a data volta a ficar disponível. Novos pedidos reservam a data provisoriamente para evitar duplicidade.

## Deploy no Shard Cloud

O projeto já está preparado para o Shard Cloud:

- `index.js` na raiz como ponto de entrada.
- `.shardcloud` com Node, 512 MB, subdomínio e inicialização na porta 80.
- `app.set('trust proxy', 1)` em produção para os cookies seguros funcionarem atrás do HTTPS.
- `PORT=80` e `NODE_ENV=production` definidos no comando de start do `.shardcloud`.

No dashboard do Shard Cloud:

1. Conecte este repositório do GitHub ao aplicativo.
2. Em **Environment Variables**, configure:
   - `SESSION_SECRET` com um valor aleatório gerado por `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
   - `ADMIN_USER=Charlotte`
   - `ADMIN_PASSWORD=123456` (ou já defina uma senha forte aqui)
   - opcionalmente `DB_PATH=./database/pinturinha.db` e `UPLOADS_DIR=./uploads`
3. Faça o primeiro deploy. O banco é criado automaticamente com **somente a usuária Charlotte**.
4. Se quiser manter os dados atuais, pare o aplicativo, envie `database/pinturinha.db` e a pasta `uploads/` pelo gerenciador de arquivos/backup do Shard Cloud e inicie novamente.
5. Use os backups do Shard Cloud antes de cada deploy que possa substituir arquivos.

O banco SQLite e as fotos dependem do armazenamento persistente do aplicativo. Não apague `database/` nem `uploads/` no servidor. O subdomínio configurado é `pinturinhamagica.shardweb.app`; ele pode ser alterado no `.shardcloud` ou no dashboard.

## Segurança implementada

- Senhas com `bcrypt`
- CSRF em todos os formulários do painel
- Limite de tentativas de login por IP
- Cookies `httpOnly` e `sameSite=lax`
- Regeneração de sessão no login
- Upload restrito a imagens (MIME + extensão) e limite de tamanho
- SQL sempre parametrizado e saída escapada pelo EJS
- Headers básicos (`nosniff`, `X-Frame-Options`, `Referrer-Policy`)

Para produção, recomenda-se ainda: HTTPS, um store de sessão persistente (ex.: `connect-sqlite3`), backup periódico do `.db` e monitoramento de erros.

## Backup

O banco `database/pinturinha.db` e a pasta `uploads/` guardam dados de produção (pedidos, contatos, hashes de senha e fotos). Eles **não são versionados no Git**. Faça backup dos dois juntos, de preferência com o servidor parado.

O arquivo `.env` também não é versionado: em outra máquina, copie `.env.example` para `.env` e configure o `SESSION_SECRET`.

Ao iniciar em um ambiente novo, o banco e a usuária inicial `Charlotte` são criados automaticamente; os dados reais precisam ser restaurados do backup.

Uma cópia do código anterior à reformulação está em `_backup/` (também fora do Git).
