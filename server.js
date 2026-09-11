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

// Preencha com o host real do seu HiveMQ Cloud mantendo mqtts:// e :8883
const MQTT_BROKER = 'mqtts://SEU_HOST.s1.eu.hivemq.cloud:8883';
const MQTT_USER = 'pomar_iot';
const MQTT_PASS = 'SUA_SENHA_HIVEMQ';

const axiosAsaas = axios.create({
  baseURL: ASAAS_URL,
  headers: { access_token: ASAAS_TOKEN }
});

const mqttClient = mqtt.connect(MQTT_BROKER, {
  username: MQTT_USER,
  password: MQTT_PASS,
  rejectUnauthorized: false
});

mqttClient.on('connect', () => {
  console.log('[MQTT] Conectado ao HiveMQ Cloud!');
  mqttClient.subscribe('pomar/+/status');
});

const boxesStatus = {
  1: { relay: false, kwh: 0, watts: 0, reais: 0 },
  2: { relay: false, kwh: 0, watts: 0, reais: 0 }
};

mqttClient.on('message', (topic, message) => {
  try {
    const data = JSON.parse(message.toString());
    const boxId = topic.split('/')[1].replace('box', '');
    boxesStatus[boxId] = data;
  } catch (err) {}
});

let clientePadraoId = null;

// Garante um cliente balcao com CPF valido no Asaas
async function carregarClienteBalcao() {
  try {
    const busca = await axiosAsaas.get('/customers?name=Consumidor Recarga');
    if (busca.data.data && busca.data.data.length > 0) {
      clientePadraoId = busca.data.data[0].id;
    } else {
      const novo = await axiosAsaas.post('/customers', {
        name: 'Consumidor Recarga',
        cpfCnpj: '11144477735'
      });
      clientePadraoId = novo.data.id;
    }
    console.log(`[ASAAS] Pronto para cobranças. ID Balcao: ${clientePadraoId}`);
  } catch (err) {
    console.error('[ERRO INIT CLIENTE]:', err.response?.data || err.message);
  }
}

app.get('/ping', (req, res) => res.send('OK'));

app.get('/api/status/:box', (req, res) => {
  res.json(boxesStatus[req.params.box] || {});
});

// Gera PIX instantâneo apenas com o valor e a vaga
app.post('/api/criar-pix', async (req, res) => {
  const { boxId, valor } = req.body;

  try {
    if (!clientePadraoId) await carregarClienteBalcao();

    const payment = await axiosAsaas.post('/payments', {
      customer: clientePadraoId,
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
    console.error('[ERRO PIX]:', error.response?.data || error.message);
    res.status(500).json({ error: 'Erro ao emitir PIX' });
  }
});

// Recebe a confirmacao de pagamento e arma a contatora
app.post('/webhook-asaas', (req, res) => {
  const { event, payment } = req.body;

  if (event === 'PAYMENT_RECEIVED' && payment) {
    const ref = payment.externalReference;
    if (ref && ref.startsWith('BOX_')) {
      const boxId = ref.replace('BOX_', '');
      console.log(`[PAGO] Vaga 0${boxId} -> R$ ${payment.value}`);

      mqttClient.publish(`pomar/box${boxId}/cmd`, JSON.stringify({
        acao: 'START',
        reais: payment.value
      }));
    }
  }
  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Servidor ativo na porta ${PORT}`);
  await carregarClienteBalcao();
});
