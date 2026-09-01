const express = require('express');
const app = express();
app.use(express.json());

app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`API listening on ${PORT}`));