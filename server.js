import express from 'express';
import net from 'net';
import dns from 'dns/promises';
import os from 'os';

const app = express();
const PORT = process.env.PORT || 10000;
const TEST_TOKEN = process.env.TEST_TOKEN;

// === 固定目标，不允许 URL 参数指定 host ===
const SMTP_HOST = 'smtp.gmail.com';
const SMTP_PORTS = [25, 465, 587];
const TIMEOUT_MS = 5000;

// === 保活端点 ===
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    message: 'Render service is alive'
  });
});

// === 首页 ===
app.get('/', (req, res) => {
  res.send('Render SMTP Network Test');
});

// === SMTP 出站连通性测试 ===
app.get('/network-test', async (req, res) => {
  // token 校验
  if (TEST_TOKEN && req.query.token !== TEST_TOKEN) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const checkPort = (port) => new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(result);
    };
    const timer = setTimeout(() => done('timeout'), TIMEOUT_MS);
    socket.on('connect', () => done('open'));
    socket.on('error', (err) => {
      if (['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH'].includes(err.code)) {
        done('blocked');
      } else {
        done('error');
      }
    });
    socket.connect(port, SMTP_HOST);
  });

  const checkDns = async () => {
    let ipv4 = 'unavailable';
    let ipv6 = 'unavailable';
    let dnsStatus = 'ok';
    try {
      ipv4 = (await dns.resolve4(SMTP_HOST)).join(', ');
    } catch {
      dnsStatus = 'error';
    }
    try {
      ipv6 = (await dns.resolve6(SMTP_HOST)).join(', ');
    } catch {
      // IPv6 不可用不算整体错误
    }
    return { dns: dnsStatus, ipv4, ipv6 };
  };

  const [tcpResults, dnsResult] = await Promise.all([
    Promise.all(SMTP_PORTS.map(checkPort)),
    checkDns(),
  ]);

  res.json({
    timestamp: new Date().toISOString(),
    ...dnsResult,
    tcp25: tcpResults[0],
    tcp465: tcpResults[1],
    tcp587: tcpResults[2],
    environment: {
      node: process.version,
      os: `${os.type()} ${os.release()}`,
      arch: os.arch(),
      hostname: os.hostname(),
    },
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
