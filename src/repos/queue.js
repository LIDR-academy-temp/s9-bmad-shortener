const amqp = require('amqplib');
const pino = require('pino');

const QUEUE_NAME = 'click-events';

const logger = pino();

let connectionPromise = null;
let channelPromise = null;

async function ensureChannel() {
  if (!connectionPromise) {
    connectionPromise = amqp
      .connect(process.env.RABBITMQ_URL)
      .then((connection) => {
        connection.on('error', (err) => {
          logger.error({ err }, 'rabbitmq connection error');
          connectionPromise = null;
          channelPromise = null;
        });
        connection.on('close', () => {
          connectionPromise = null;
          channelPromise = null;
        });
        return connection;
      })
      .catch((err) => {
        connectionPromise = null;
        channelPromise = null;
        throw err;
      });
  }

  if (!channelPromise) {
    channelPromise = connectionPromise
      .then((connection) => connection.createChannel())
      .then(async (channel) => {
        channel.on('error', (err) => {
          logger.error({ err }, 'rabbitmq channel error');
          channelPromise = null;
        });
        channel.on('close', () => {
          channelPromise = null;
        });
        await channel.assertQueue(QUEUE_NAME, { durable: true });
        return channel;
      })
      .catch((err) => {
        channelPromise = null;
        throw err;
      });
  }

  return channelPromise;
}

async function publishToQueue(message) {
  try {
    const channel = await ensureChannel();
    channel.sendToQueue(QUEUE_NAME, Buffer.from(JSON.stringify(message)), {
      persistent: true,
    });
  } catch (err) {
    connectionPromise = null;
    channelPromise = null;
    throw err;
  }
}

module.exports = { publishToQueue };
