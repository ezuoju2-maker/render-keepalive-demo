import express from 'express';

const app = express();
const PORT = process.env.PORT || 10000;

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    message: 'Render service is alive'
  });
});

app.get('/', (req, res) => {
  res.send('Hello from Render!');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
