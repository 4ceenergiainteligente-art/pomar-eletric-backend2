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
const MQTT_BROKER = '4ce38ccb1a3b4f7983ccc33ebd70ca88.s1.eu.hivemq.cloud';
const MQTT_USER = 'pomar_iot';
const MQTT_PASS = 'Pomar@2026p';

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
  console.log('[MQTT] Conectado ao HiveMQ Cloud com sucesso!');
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

// Localiza cliente por CPF, cria um novo ou usa o consumidor geral
async function obterOuCriarCliente(nome, cpf) {
  const cpfLimpo = cpf ? cpf.replace(/\D/g, '') : '';

  // 1. Se informou CPF, busca se já existe
  if (cpfLimpo.length === 11) {
    try {
      const busca = await axiosAsaas.get(`/customers?cpfCnpj=${cpfLimpo}`);
      if (busca.data.data && busca.data.data.length > 0) {
        return busca.data.data[0].id;
      }
      // Não existe: cria novo cliente
      const novo = await axiosAsaas.post('/customers', {
        name: nome || 'Motorista EV',
        cpfCnpj: cpfLimpo
      });
      return novo.data.id;
    } catch (err) {
      console.error('[ERRO BUSCA/CRIA CLIENTE]:', err.response?.data || err.message);
    }
  }

  // 2. Fluxo rápido / sem CPF: busca ou cria o cliente genérico
  try {
    const buscaGeral = await axiosAsaas.get('/customers?name=Consumidor EV');
    if (buscaGeral.data.data && buscaGeral.data.data.length > 0) {
      return buscaGeral.data.data[0].id;
    }
    const novoGeral = await axiosAsaas.post('/customers', {
      name: 'Consumidor EV'
    });
    return novoGeral.data.id;
  } catch (err) {
    // Caso padrão de fallback
    const list = await axiosAsaas.get('/customers');
    return list.data.data[0].id;
  }
}

app.get('/ping', (req, res) => res.send('OK'));

app.get('/api/status/:box', (req, res) => {
  res.json(boxesStatus[req.params.box] || {});
});

app.post('/api/criar-pix', async (req, res) => {
  const { boxId, valor, nome, cpf } = req.body;

  try {
    const customerId = await obterOuCriarCliente(nome, cpf);

    const payment = await axiosAsaas.post('/payments', {
      customer: customerId,
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
    console.error('[ERRO PIX]:', error.response?.data || error.message);
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
app.listen(PORT, () => {
  console.log(`Servidor ativo na porta ${PORT}`);
});
