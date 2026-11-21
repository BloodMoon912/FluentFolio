import dgram from 'node:dgram';

const host = 'stdtime.gov.hk';
const port = 123;
const NTP_UNIX_EPOCH = 2208988800;

function queryNtp(timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    const packet = Buffer.alloc(48);
    packet[0] = 0x1b;
    const started = Date.now();
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`NTP request to ${host} timed out after ${timeoutMs} ms`));
    }, timeoutMs);

    socket.once('error', (error) => {
      clearTimeout(timer);
      socket.close();
      reject(error);
    });

    socket.once('message', (message) => {
      clearTimeout(timer);
      const receivedAt = Date.now();
      socket.close();
      if (message.length < 48) return reject(new Error('Invalid NTP response'));
      const seconds = message.readUInt32BE(40);
      const fraction = message.readUInt32BE(44);
      const serverMs = (seconds - NTP_UNIX_EPOCH) * 1000 + Math.round((fraction * 1000) / 2 ** 32);
      resolve({ serverMs, receivedAt, rttMs: receivedAt - started });
    });

    socket.send(packet, port, host);
  });
}

try {
  const result = await queryNtp();
  const localMs = Date.now();
  const offsetMs = result.serverMs - localMs;
  console.log(`HKO NTP: ${host}:${port}`);
  console.log(`Server: ${new Date(result.serverMs).toISOString()}`);
  console.log(`Local : ${new Date(localMs).toISOString()}`);
  console.log(`Offset: ${offsetMs >= 0 ? '+' : ''}${offsetMs} ms`);
  console.log(`RTT   : ${result.rttMs} ms`);
} catch (error) {
  console.error(`Failed to query ${host}:`, error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
