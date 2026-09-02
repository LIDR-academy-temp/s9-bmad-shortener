const pino = require('pino');
const queue = require('../repos/queue');
const linksRepo = require('../repos/linksRepo');

const logger = pino();

async function handleMessage(content) {
  try {
    const body = JSON.parse(content.toString());
    if (!body || typeof body.code !== 'string' || !body.code) {
      throw new Error('malformed click event body');
    }
    await linksRepo.incrementClickCount(body.code);
  } catch (err) {
    logger.error({ err }, 'failed to process click event');
  }
}

async function start() {
  return queue.consumeQueue(handleMessage).catch((err) => {
    logger.error({ err }, 'failed to start click consumer');
  });
}

module.exports = { start, handleMessage };
