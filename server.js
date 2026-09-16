import express from 'express';
import net from 'net';
import dns from 'dns/promises';
import os from 'os';

const app = express();
const PORT = process.env.PORT || 10000;
const TEST_TOKEN = process.env.TEST_TOKEN;

const TIMEOUT_MS = 5000;

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/', (req, res) => res.send('Render SMTP Network Test v2'));

// === 精确 TCP 诊断 ===
// family: 4 = 强制 IPv4, family: 6 = 强制 IPv6, family: 0 = 默认
function checkTcp(host, port, family) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const start = Date.now();

    const done = (result, extra = {}) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve({ result, ms: Date.now() - start, ...extra });
    };

    const timer = setTimeout(() => done('timeout'), TIMEOUT_MS);

    socket.on('connect', () => done('open'));
    socket.on('error', (err) => {
      const code = err.code || 'UNKNOWN';
      if (['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH'].includes(code)) {
        done('blocked', { errCode: code });
      } else if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT') {
        done('timeout', { errCode: code });
      } else {
        done('error', { errCode: code, errMsg: err.message });
      }
    });

    const opts = { host, port };
    if (family === 4 || family === 6) opts.family = family;
    socket.connect(opts);
  });
}

app.get('/network-test', async (req, res) => {
  if (TEST_TOKEN && req.query.token !== TEST_TOKEN) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const SMTP = 'smtp.gmail.com';
  const HOST = 'github.com';  // 阳性对照

  // 1. DNS
  let ipv4List = [], ipv6List = [];
  try { ipv4List = await dns.resolve4(SMTP); } catch {}
  try { ipv6List = await dns.resolve6(SMTP); } catch {}

  // 2. IPv4 强制测试 SMTP 三端口
  const smtp4_25  = await checkTcp(SMTP, 25,  4);
  const smtp4_465 = await checkTcp(SMTP, 465, 4);
  const smtp4_587 = await checkTcp(SMTP, 587, 4);

  // 3. IPv6 强制测试 SMTP 三端口（如果 IPv6 可用）
  const smtp6_25  = ipv6List.length ? await checkTcp(SMTP, 25,  6) : { result: 'no-ipv6' };
  const smtp6_465 = ipv6List.length ? await checkTcp(SMTP, 465, 6) : { result: 'no-ipv6' };
  const smtp6_587 = ipv6List.length ? await checkTcp(SMTP, 587, 6) : { result: 'no-ipv6' };

  // 4. 阳性对照：github.com:443（应该 open）+ github.com:8080（应该 blocked/timeout）
  const gh443  = await checkTcp(HOST, 443,  4);
  const gh8080 = await checkTcp(HOST, 8080, 4);

  res.json({
    timestamp: new Date().toISOString(),
    dns: { ipv4: ipv4List, ipv6: ipv6List },
    // 关键测试：IPv4
    smtp_ipv4: {
      tcp25:  smtp4_25,
      tcp465: smtp4_465,
      tcp587: smtp4_587,
    },
    // 次要测试：IPv6
    smtp_ipv6: {
      tcp25:  smtp6_25,
      tcp465: smtp6_465,
      tcp587: smtp6_587,
    },
    // 阳性对照
    control: {
      github443:  gh443,
      github8080: gh8080,
    },
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
