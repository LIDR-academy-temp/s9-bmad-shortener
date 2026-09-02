const pino = require('pino');
const queue = require('../repos/queue');

const logger = pino();

async function publishClickEvent(code) {
  const message = { code, timestamp: new Date().toISOString() };
  return queue.publishToQueue(message).catch((err) => {
    logger.error({ err, code }, 'failed to publish click event');
  });
}

module.exports = { publishClickEvent };
