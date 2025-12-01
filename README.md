🟢 Plataforma WhatsApp – GP Labs

Atendimento, Inbox, Envio de Mensagens e Webhook WhatsApp Business API
Desenvolvido com Node.js, Express, Vite + React e Webhooks da Meta.

📌 Visão Geral

Este projeto permite:

Receber mensagens do WhatsApp via Webhook

Exibir conversas em tempo real em uma Inbox moderna

Enviar mensagens para contatos diretamente pelo painel

Agrupar mensagens por telefone

Funcionar com Ngrok ou Cloudflare Tunnel

Integrar com a WhatsApp Cloud API (Meta)

O backend recebe todas as mensagens via Webhook e envia ao frontend pela API.
O frontend exibe conversas, envia mensagens e mantém a sincronização com a API do WhatsApp.

🚀 Tecnologias Utilizadas
Backend

Node.js

Express

CORS

dotenv

node-fetch

Webhook WhatsApp Cloud API

Cloudflare Tunnel ou Ngrok

Frontend

React (Vite)

Axios

Tailwind (opcional)

Zustand (estado simples)

Componentes customizados

📂 Estrutura do Projeto
whatsapp-plataforma/
│
├── backend/
│   ├── src/
│   │   ├── index.js
│   │   ├── webhook.js
│   │   ├── conversations.js
│   │   └── utils.js
│   ├── .env
│   ├── package.json
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   └── App.jsx
│   ├── package.json
│
└── README.md

🛠️ Como rodar o projeto na sua máquina
1️⃣ Clonar o repositório
git clone https://github.com/SEU_USUARIO/whatsapp-plataforma.git
cd whatsapp-plataforma

📦 Backend
2️⃣ Entrar na pasta do backend
cd backend

2.1 Instalar dependências
npm install

2.2 Criar arquivo .env

Crie o arquivo:

WHATSAPP_TOKEN=SEU_TOKEN_DA_META
PHONE_NUMBER_ID=ID_DO_SEU_NUMERO
VERIFY_TOKEN=qualquer_token_de_verificacao
PORT=3001


Exemplo real usado:

WHATSAPP_TOKEN=EAATgPLG3UJ0BQEZB...
PHONE_NUMBER_ID=937463642775392
VERIFY_TOKEN=meutoken123
PORT=3001

2.3 Iniciar o backend
npm run dev


O terminal deve exibir:

API rodando na porta 3001

🎨 Frontend
3️⃣ Rodar o frontend
cd ../frontend
npm install
npm run dev


Abra:

👉 http://localhost:5173/

📡 Conectando ao WhatsApp (Webhook da Meta)
4️⃣ Criar o Webhook no painel da Meta (WhatsApp Cloud API)

Acesse:

👉 https://developers.facebook.com/

Vá em:

Configurações da API > Webhooks

Preencha:

URL do callback:

Se estiver usando Ngrok:

https://SEU_SUBDOMINIO.ngrok-free.app/webhook/whatsapp


Se estiver usando Cloudflare Tunnel:

https://whatsapp.gphparticipacoes.com.br/webhook/whatsapp


Token de verificação
O mesmo do .env → VERIFY_TOKEN

4.1 Campos a assinar:

✔️ messages
✔️ messages_status

4.2 Depois clique em Verificar e Salvar
🛣️ Túnel para receber Webhooks

Você tem duas opções:

☁️ OPÇÃO 1 — Cloudflare Tunnel (Recomendado)
1. Instalar
brew install cloudflared

2. Login
cloudflared tunnel login

3. Criar tunnel
cloudflared tunnel create whatsapp-plataforma


Anote:

UUID do tunnel

Caminho do credentials.json

4. Criar config:
nano ~/.cloudflared/config.yml


Colar:

tunnel: UUID_DO_TUNNEL
credentials-file: /Users/SEU_USUARIO/.cloudflared/UUID.json

ingress:
  - hostname: whatsapp.gphparticipacoes.com.br
    service: http://localhost:3001
  - service: http_status:404

5. Criar CNAME no Cloudflare:

Nome:

whatsapp


Aponta para:

UUID.cfargotunnel.com

6. Rodar o tunnel:
cloudflared tunnel run whatsapp-plataforma

🐍 OPÇÃO 2 — Ngrok (mais fácil, porém limitado)
1. Instalar
brew install ngrok

2. Login
ngrok config add-authtoken SEU_TOKEN

3. Rodar:
ngrok http 3001


Ele dará algo como:

https://nicohol-dilettanteish-darline.ngrok-free.app -> http://localhost:3001


Use isso no Webhook.

📥 Como funciona o Webhook

O WhatsApp envia uma mensagem para:

/webhook/whatsapp


O backend recebe:

Nome do remetente

Mensagem

Timestamp

Número do telefone

E salva em memória:

messages[phone].push({
  direction: "in",
  text,
  timestamp: new Date()
});


Depois o frontend consulta o histórico com:

GET /conversations
GET /conversations/:phone

📨 Enviar Mensagem pelo Frontend

O frontend faz:

POST /conversations/:phone/messages


O backend envia ao WhatsApp Cloud API:

https://graph.facebook.com/v20.0/PHONE_NUMBER_ID/messages


Retorna:

"wamid.HBgMNTU2..."


E exibe na interface como mensagem enviada (out).

🔄 Fluxo Completo de Envio e Recebimento
Celular → WhatsApp → Webhook → Backend → Inbox Frontend
             ↑                                   ↓
           Envio ←—————————————— Frontend ←——— API

🐞 Erros Comuns Resolvidos Aqui

✔ Webhook batendo no backend
✔ Mensagens enviadas via curl funcionando
✔ Inbox recebendo mensagens duplicadas
✔ Conversas separadas por telefone
✔ Tunnel Cloudflare substituindo Ngrok
✔ .env carregado corretamente
✔ Conflitos de porta do Vite
✔ Backend rodando com nodemon

🤝 Contribuição

Sinta-se à vontade para abrir issues ou enviar PRs no GitHub.

📄 Licença

Projeto proprietário — uso restrito à GP Labs / GPHolding.
