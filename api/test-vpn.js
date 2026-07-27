// ============================================================
// NOC PREDITIVO — API: Teste de Reachability VPN
// Testa TCP reachability para o servidor VPN
// ============================================================

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { host, port } = req.query;

  if (!host || !port) {
    return res.status(400).json({ erro: 'host e port sao obrigatorios' });
  }

  const start = Date.now();
  try {
    // Tentar TCP connect
    const net = require('net');
    const socket = new net.Socket();
    socket.setTimeout(5000);

    const result = await new Promise((resolve) => {
      socket.on('connect', () => {
        socket.destroy();
        resolve({ reachable: true, latency: Date.now() - start });
      });
      socket.on('timeout', () => {
        socket.destroy();
        resolve({ reachable: false, error: 'timeout' });
      });
      socket.on('error', (err) => {
        socket.destroy();
        resolve({ reachable: false, error: err.message });
      });
      socket.connect(parseInt(port), host);
    });

    res.json({
      host, port: parseInt(port),
      reachable: result.reachable,
      latency_ms: result.reachable ? result.latency : null,
      error: result.error || null,
      timestamp: new Date().toISOString()
    });
  } catch (e) {
    res.json({
      host, port: parseInt(port),
      reachable: false,
      error: e.message,
      timestamp: new Date().toISOString()
    });
  }
};
