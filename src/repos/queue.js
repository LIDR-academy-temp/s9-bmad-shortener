const amqp = require('amqplib');
const pino = require('pino');

const QUEUE_NAME = 'click-events';

const logger = pino();

let connectionPromise = null;
let channelPromise = null;
let consumeChannelPromise = null;

async function ensureConnection() {
  if (!connectionPromise) {
    connectionPromise = amqp
      .connect(process.env.RABBITMQ_URL)
      .then((connection) => {
        connection.on('error', (err) => {
          logger.error({ err }, 'rabbitmq connection error');
          connectionPromise = null;
          channelPromise = null;
          consumeChannelPromise = null;
        });
        connection.on('close', () => {
          connectionPromise = null;
          channelPromise = null;
          consumeChannelPromise = null;
        });
        return connection;
      })
      .catch((err) => {
        connectionPromise = null;
        channelPromise = null;
        consumeChannelPromise = null;
        throw err;
      });
  }

  return connectionPromise;
}

function createManagedChannel(connPromise, errorLabel, resetChannelPromise) {
  return connPromise
    .then((connection) => connection.createChannel())
    .then(async (channel) => {
      channel.on('error', (err) => {
        logger.error({ err }, errorLabel);
        resetChannelPromise();
      });
      channel.on('close', () => {
        resetChannelPromise();
      });
      await channel.assertQueue(QUEUE_NAME, { durable: true });
      return channel;
    })
    .catch((err) => {
      resetChannelPromise();
      throw err;
    });
}

async function ensureChannel() {
  await ensureConnection();

  if (!channelPromise) {
    channelPromise = createManagedChannel(
      connectionPromise,
      'rabbitmq channel error',
      () => {
        channelPromise = null;
      }
    );
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
    consumeChannelPromise = null;
    throw err;
  }
}

async function ensureConsumeChannel() {
  await ensureConnection();

  if (!consumeChannelPromise) {
    consumeChannelPromise = createManagedChannel(
      connectionPromise,
      'rabbitmq consume channel error',
      () => {
        consumeChannelPromise = null;
      }
    );
  }

  return consumeChannelPromise;
}

async function consumeQueue(onMessage) {
  const channel = await ensureConsumeChannel();
  await channel.consume(
    QUEUE_NAME,
    (msg) => {
      if (msg) {
        onMessage(msg.content);
      }
    },
    { noAck: true }
  );
}

module.exports = { publishToQueue, consumeQueue };
