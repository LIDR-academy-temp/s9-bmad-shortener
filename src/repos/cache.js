const { createClient } = require('redis');

const client = createClient({ url: process.env.REDIS_URL });

let connectingPromise = null;

async function ensureConnected() {
  if (client.isOpen) {
    return;
  }
  if (!connectingPromise) {
    connectingPromise = client
      .connect()
      .catch((err) => {
        connectingPromise = null;
        throw err;
      })
      .then(() => {
        connectingPromise = null;
      });
  }
  await connectingPromise;
}

async function getCachedUrl(code) {
  await ensureConnected();
  return client.get(`shorturl:${code}`);
}

async function setCachedUrl(code, longUrl) {
  await ensureConnected();
  await client.set(`shorturl:${code}`, longUrl);
}

module.exports = { getCachedUrl, setCachedUrl };
