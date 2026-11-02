// The initial host only negotiates protocol support. It never accepts playback
// URLs or authentication data until secure pairing is implemented.
export const NATIVE_HOST = 'com.vodown.desktop';
export const NATIVE_PROTOCOL_VERSION = 1;
export function helloRequest(requestId) {
  if (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(requestId)) throw new Error('Identificador inválido.');
  return {version:NATIVE_PROTOCOL_VERSION,requestId,type:'hello'};
}
export function parseHello(message, requestId) {
  if (!message || typeof message !== 'object' || message.version !== NATIVE_PROTOCOL_VERSION || message.requestId !== requestId || message.type !== 'hello' || !['desktop_not_connected','desktop_connected'].includes(message.code) || !Array.isArray(message.capabilities) || !message.capabilities.includes('handshake')) throw new Error('Resposta do aplicativo incompatível.');
  return {connected:message.code==='desktop_connected',reason:message.code};
}
