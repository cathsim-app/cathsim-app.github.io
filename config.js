// Zugangscode für die Testrunde. Nur eine Tür, kein Schloss: wer die Seite liest,
// findet ihn. Für echten Schutz Cloudflare Access vor die Seite legen.
window.CATHSIM_CONFIG = {
  accessCode: 'angio2026', ctFile: 'ct_body.vol', wasmFile: 'engine.wasm',
  // Vermittlung Handy ↔ Station: öffentliche MQTT-Broker über WebSocket, alle gleichzeitig
  // (Firewalls lassen nicht jeden durch). Es laufen nur Steuerbefehle und Status darüber,
  // keine Patientendaten; der Raumcode ist das Geheimnis.
  brokers: ['wss://broker.hivemq.com:8884/mqtt', 'wss://broker.emqx.io:8084/mqtt', 'wss://test.mosquitto.org:8081'],
  topicRoot: 'cathsim/v1',
  // Anmeldeprotokoll: Adresse eines kleinen Cloudflare-Workers (siehe worker/README.md).
  // Leer = kein Protokoll. Beispiel: 'https://cathsim-log.<konto>.workers.dev'
  logEndpoint: 'https://cathsim-log.cathsim.workers.dev',
  logKey: 'angio2026',
};
