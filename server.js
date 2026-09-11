const express = require('express');
const axios = require('axios');
const mqtt = require('mqtt');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// --- CONFIGURAÇÕES ---
const ASAAS_URL = 'https://sandbox.asaas.com/v3';
const ASAAS_TOKEN = '$aact_hmlg_000MzkwODA2MWY2OGM3MWRlMDU2NWM3MzJlNzZmNGZhZGY6OjczNjU5OWQzLTFkNTMtNDJmZi1hNTI4LTFiNDRjNTQyZDU1Mjo6JGFhY2hfNTcwOTI5MGYtZTY0YS00ZTMzLTgyM2MtMDQwM2Q1ZWIzYjUw';

const MQTT_BROKER = 'mqtts://4ce38ccb1a3b4f7983ccc33ebd70ca88.s1.eu.hivemq.cloud:8883';
const MQTT_USER = 'pomar_iot';
const MQTT_PASS = 'Pomar@2026p';

const axiosAsaas = axios.create({
  baseURL: ASAAS_URL,
  headers: { access_token: ASAAS_TOKEN }
});

// Conexão MQTT com tratamento de reconexão automática
let mqttClient;
try {
  mqttClient = mqtt.connect(MQTT_BROKER, {
    username: MQTT_USER,
    password: MQTT_PASS,
    rejectUnauthorized: false,
    reconnectPeriod: 3000
  });

  mqttClient.on('connect', () => {
    console.log('[MQTT] Conectado ao HiveMQ Cloud com sucesso!');
    mqttClient.subscribe('pomar/+/status');
  });

  mqttClient.on('error', (err) => {
    console.error('[MQTT ERRO]:', err.message);
  });
} catch (e) {
  console.error('[MQTT FALHA NO BOOT]:', e.message);
}

const boxesStatus = {
  1: { relay: false, kwh: 0, watts: 0, reais: 0 },
  2: { relay: false, kwh: 0, watts: 0, reais: 0 }
};

if (mqttClient) {
  mqttClient.on('message', (topic, message) => {
    try {
      const data = JSON.parse(message.toString());
      const boxId = topic.split('/')[1].replace('box', '');
      boxesStatus[boxId] = data;
    } catch (err) {}
  });
}

// Identifica ou cria o cliente único do totem no Asaas com CPF válido
async function obterClienteTotem() {
  try {
    const listagem = await axiosAsaas.get('/customers');
    if (listagem.data.data && listagem.data.data.length > 0) {
      const clienteExistente = listagem.data.data[0];
      if (!clienteExistente.cpfCnpj) {
        await axiosAsaas.post(`/customers/${clienteExistente.id}`, {
          cpfCnpj: '11144477735'
        });
      }
      return clienteExistente.id;
    }

    const novo = await axiosAsaas.post('/customers', {
      name: 'Caixa Balcao Totem',
      cpfCnpj: '11144477735'
    });
    return novo.data.id;
  } catch (err) {
    console.error('[ERRO AO IDENTIFICAR CLIENTE]:', err.response?.data || err.message);
    throw err;
  }
}

// 1. TELA PRINCIPAL (Entregue diretamente pelo Render sem bloqueio de navegador)
app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Recarga EV - Totem</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
    body { background: #0b0f19; color: #fff; display: flex; justify-content: center; padding: 20px 14px; min-height: 100vh; }
    .container { width: 100%; max-width: 380px; }
    .card { background: #131b2e; border: 1px solid #1e293b; border-radius: 16px; padding: 18px; margin-bottom: 14px; text-align: center; }
    .badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 700; margin-top: 6px; }
    .badge-livre { background: rgba(148, 163, 184, 0.15); color: #94a3b8; }
    .badge-carregando { background: rgba(34, 197, 94, 0.15); color: #22c55e; }
    .grid-info { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 14px; }
    .box-info { background: #0b1120; padding: 10px; border-radius: 8px; border: 1px solid #1e293b; }
    .box-label { font-size: 10px; color: #64748b; text-transform: uppercase; }
    .box-val { font-size: 16px; font-weight: bold; color: #38bdf8; margin-top: 2px; }
    .valores-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 14px 0; }
    .btn-val { background: #1e293b; border: 1px solid #334155; color: #fff; padding: 12px 0; border-radius: 8px; font-size: 16px; font-weight: 700; cursor: pointer; }
    .btn-val.active { background: #0284c7; border-color: #38bdf8; }
    .btn-pagar { width: 100%; background: #10b981; color: #022c22; border: none; padding: 14px; border-radius: 10px; font-size: 16px; font-weight: 800; cursor: pointer; }
    .btn-pagar:disabled { background: #334155; color: #64748b; }
    .pix-area { display: none; background: #0b1120; border: 1px solid #0284c7; border-radius: 12px; padding: 16px; margin-top: 14px; }
    .pix-area img { max-width: 190px; border-radius: 8px; margin: 10px auto; display: block; }
    .copia-cola { width: 100%; background: #020617; border: 1px dashed #334155; padding: 8px; border-radius: 6px; color: #94a3b8; font-size: 11px; word-break: break-all; margin: 8px 0; }
    .btn-copiar { background: #334155; color: #fff; border: none; padding: 10px; border-radius: 6px; width: 100%; font-size: 13px; font-weight: 700; cursor: pointer; }
  </style>
</head>
<body>
<div class="container">
  <div class="card">
    <h2 style="font-size: 17px;">ESTAÇÃO 01 - VAGA A</h2>
    <span id="badge-status" class="badge badge-livre">DISPONÍVEL</span>
    <div class="grid-info">
      <div class="box-info"><div class="box-label">Potência</div><div id="tel-watts" class="box-val">0 W</div></div>
      <div class="box-info"><div class="box-label">Consumido</div><div id="tel-kwh" class="box-val">0.00 kWh</div></div>
      <div class="box-info" style="grid-column: span 2;"><div class="box-label">Saldo Ativo</div><div id="tel-reais" class="box-val" style="color:#4ade80;">R$ 0,00</div></div>
    </div>
  </div>

  <div class="card">
    <div style="font-size: 13px; color: #94a3b8; text-transform: uppercase; font-weight: 600;">Escolha o Valor</div>
    <div class="valores-grid">
      <button class="btn-val" onclick="setValor(10, this)">R$ 10</button>
      <button class="btn-val active" onclick="setValor(20, this)">R$ 20</button>
      <button class="btn-val" onclick="setValor(30, this)">R$ 30</button>
    </div>

    <button id="btn-pix" class="btn-pagar" onclick="gerarPix()">GERAR PIX</button>

    <div id="pix-container" class="pix-area">
      <div style="font-size: 13px; color: #38bdf8; font-weight: 700;">Aponte o app do banco ou copie</div>
      <img id="pix-img" src="" alt="QR Code PIX" />
      <div id="pix-code" class="copia-cola"></div>
      <button class="btn-copiar" onclick="copiar()">Copiar Código PIX</button>
    </div>
  </div>
</div>

<script>
  const BOX_ID = 1;
  let valor = 20.00;

  function setValor(v, btn) {
    valor = v;
    document.querySelectorAll('.btn-val').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }

  async function gerarPix() {
    const btn = document.getElementById('btn-pix');
    const area = document.getElementById('pix-container');
    btn.disabled = true;
    btn.innerText = "Gerando QR Code...";

    try {
      const res = await fetch('/api/criar-pix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ boxId: BOX_ID, valor: valor })
      });

      const data = await res.json();
      if (data.copiaCola) {
        document.getElementById('pix-img').src = 'data:image/png;base64,' + data.qrCodeBase64;
        document.getElementById('pix-code').innerText = data.copiaCola;
        area.style.display = 'block';
        btn.innerText = "Aguardando Pagamento...";
      } else {
        alert("Erro Asaas: " + (data.error || "Tente novamente"));
        btn.disabled = false;
        btn.innerText = "GERAR PIX";
      }
    } catch (err) {
      alert("Falha de comunicação com o servidor.");
      btn.disabled = false;
      btn.innerText = "GERAR PIX";
    }
  }

  function copiar() {
    navigator.clipboard.writeText(document.getElementById('pix-code').innerText).then(() => {
      alert("Código PIX copiado!");
    });
  }

  async function atualizar() {
    try {
      const res = await fetch('/api/status/' + BOX_ID);
      const data = await res.json();
      if (data.relay !== undefined) {
        const badge = document.getElementById('badge-status');
        badge.className = data.relay ? "badge badge-carregando" : "badge badge-livre";
        badge.innerText = data.relay ? "⚡ CARREGANDO" : "DISPONÍVEL";
        document.getElementById('tel-watts').innerText = Math.round(data.watts || 0) + ' W';
        document.getElementById('tel-kwh').innerText = (data.session_kwh || 0).toFixed(2) + ' kWh';
        document.getElementById('tel-reais').innerText = 'R$ ' + (data.reais || 0).toFixed(2).replace('.', ',');
      }
    } catch (e) {}
  }

  setInterval(atualizar, 2000);
  atualizar();
</script>
</body>
</html>`);
});

app.get('/ping', (req, res) => res.send('OK'));

app.get('/api/status/:box', (req, res) => {
  res.json(boxesStatus[req.params.box] || {});
});

// Emite cobrança PIX anônima
app.post('/api/criar-pix', async (req, res) => {
  const { boxId, valor } = req.body;
  try {
    const customerId = await obterClienteTotem();

    const payment = await axiosAsaas.post('/payments', {
      customer: customerId,
      billingType: 'PIX',
      value: parseFloat(valor),
      dueDate: new Date().toISOString().split('T')[0],
      description: `Recarga EV - Vaga 0${boxId}`,
      externalReference: `BOX_${boxId}`
    });

    const pixDetails = await axiosAsaas.get(`/payments/${payment.data.id}/pixQrCode`);

    res.json({
      copiaCola: pixDetails.data.payload,
      qrCodeBase64: pixDetails.data.encodedImage
    });
  } catch (error) {
    const detalhe = error.response?.data?.errors?.[0]?.description 
      || error.response?.data?.message 
      || error.message;
    console.error('[ERRO PIX]:', detalhe);
    res.status(500).json({ error: detalhe });
  }
});

// Webhook para ligar o relé via MQTT quando o pagamento cair
app.post('/webhook-asaas', (req, res) => {
  const { event, payment } = req.body;

  if (event === 'PAYMENT_RECEIVED' && payment) {
    const ref = payment.externalReference;
    if (ref && ref.startsWith('BOX_')) {
      const boxId = ref.replace('BOX_', '');
      console.log(`[PAGO] Vaga 0${boxId} -> R$ ${payment.value}`);

      if (mqttClient) {
        mqttClient.publish(`pomar/box${boxId}/cmd`, JSON.stringify({
          acao: 'START',
          reais: payment.value
        }));
      }
    }
  }
  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor ativo na porta ${PORT}`);
});
