const express = require('express');
const axios = require('axios');
const mqtt = require('mqtt');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// --- CONFIGURAÇÃO ASAAS SANDBOX ---
const ASAAS_URL = 'https://sandbox.asaas.com/v3';
const ASAAS_TOKEN = '$aact_hmlg_000MzkwODA2MWY2OGM3MWRlMDU2NWM3MzJlNzZmNGZhZGY6OjczNjU5OWQzLTFkNTMtNDJmZi1hNTI4LTFiNDRjNTQyZDU1Mjo6JGFhY2hfNTcwOTI5MGYtZTY0YS00ZTMzLTgyM2MtMDQwM2Q1ZWIzYjUw';

// --- CONFIGURAÇÃO HIVEMQ CLOUD ---
const MQTT_BROKER = 'mqtts://SEU_CLUSTER.s1.eu.hivemq.cloud:8883';
const MQTT_USER = 'pomar_iot';
const MQTT_PASS = 'SUA_SENHA_HIVEMQ';

const axiosAsaas = axios.create({
  baseURL: ASAAS_URL,
  headers: { access_token: ASAAS_TOKEN }
});

let defaultCustomerId = null;

async function initCustomer() {
  try {
    const list = await axiosAsaas.get('/customers?name=Consumidor EV');
    if (list.data.data && list.data.data.length > 0) {
      defaultCustomerId = list.data.data[0].id;
    } else {
      const created = await axiosAsaas.post('/customers', {
        name: 'Consumidor Recarga EV',
        cpfCnpj: '00000000000'
      });
      defaultCustomerId = created.data.id;
    }
    console.log(`[ASAAS] Cliente padrao ativo: ${defaultCustomerId}`);
  } catch (err) {
    console.error('[ASAAS ERRO]:', err.response?.data || err.message);
  }
}

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
  2: { relay: false, kwh: 0, watts: 0, reais: 0 },
  3: { relay: false, kwh: 0, watts: 0, reais: 0 },
  4: { relay: false, kwh: 0, watts: 0, reais: 0 }
};

mqttClient.on('message', (topic, message) => {
  try {
    const data = JSON.parse(message.toString());
    const boxId = topic.split('/')[1].replace('box', '');
    boxesStatus[boxId] = data;
  } catch (err) {}
});

app.get('/ping', (req, res) => res.send('OK'));

app.get('/api/status/:box', (req, res) => {
  const boxId = req.params.box;
  res.json(boxesStatus[boxId] || {});
});

app.post('/api/criar-pix', async (req, res) => {
  const { boxId, valor } = req.body;

  if (!defaultCustomerId) {
    return res.status(503).json({ error: 'Cliente Asaas inicializando...' });
  }

  try {
    const payment = await axiosAsaas.post('/payments', {
      customer: defaultCustomerId,
      billingType: 'PIX',
      value: parseFloat(valor),
      dueDate: new Date().toISOString().split('T')[0],
      description: `Recarga EV - Vaga 0${boxId} - Pomar Eletric`,
      externalReference: `BOX_${boxId}`
    });

    const pixDetails = await axiosAsaas.get(`/payments/${payment.data.id}/pixQrCode`);

    res.json({
      paymentId: payment.data.id,
      copiaCola: pixDetails.data.payload,
      qrCodeBase64: pixDetails.data.encodedImage
    });
  } catch (error) {
    res.status(500).json({ error: error.response?.data || error.message });
  }
});

app.post('/webhook-asaas', (req, res) => {
  const { event, payment } = req.body;

  if (event === 'PAYMENT_RECEIVED' && payment) {
    const ref = payment.externalReference;
    if (ref && ref.startsWith('BOX_')) {
      const boxId = ref.replace('BOX_', '');
      const valorPago = payment.value;

      console.log(`[PIX CONFIRMADO] Vaga 0${boxId} -> R$ ${valorPago}`);

      mqttClient.publish(`pomar/box${boxId}/cmd`, JSON.stringify({
        acao: 'START',
        reais: valorPago
      }));
    }
  }
  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Servidor ativo na porta ${PORT}`);
  await initCustomer();
});
