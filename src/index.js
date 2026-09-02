const app = require('./app');
const { bootstrapSchema } = require('./repos/db');
const clickConsumer = require('./services/clickConsumer');

const PORT = process.env.PORT || 8000;

bootstrapSchema()
  .then(() => {
    app.listen(PORT, () => console.log(`API listening on ${PORT}`));
    clickConsumer.start().catch(() => {});
  })
  .catch((err) => {
    console.error('Failed to bootstrap schema', err);
    process.exit(1);
  });
