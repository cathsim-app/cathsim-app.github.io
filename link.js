// Verbindung zwischen Handy und Station über öffentliche MQTT-Broker (WebSocket).
// Raumcode → drei Themen: ctrl (Handy → Station), status (Station → Handy), hello.
//
// Nicht jedes Netz lässt jeden Broker durch (Klinik-WLAN sperrt gern fremde Ports,
// Mobilfunk nicht). Darum hängt jede Seite an allen Brokern gleichzeitig, sendet
// über alle und nimmt jede Nachricht nur einmal an – so finden sich Handy und Station,
// sobald sie auch nur einen Broker gemeinsam erreichen.
(function () {
  const cfg = window.CATHSIM_CONFIG;
  function makeCode() { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < 6; i++) s += a[Math.floor(Math.random() * a.length)]; return s; }
  function connect(code, role, onMessage, onState) {
    const topics = { ctrl: `${cfg.topicRoot}/${code}/ctrl`, status: `${cfg.topicRoot}/${code}/status`, hello: `${cfg.topicRoot}/${code}/hello` };
    const sub = role === 'station' ? [topics.ctrl, topics.hello] : [topics.status, topics.hello];
    const origin = Math.random().toString(36).slice(2, 8); let seq = 0, closed = false;
    const clients = []; const seen = new Map(); // Herkunft → letzte Laufnummer
    function report() {
      const up = clients.filter(c => c.connected).length;
      onState(up ? 'verbunden' : (clients.some(c => c.trying) ? 'verbinde' : 'getrennt'), clients.filter(c => c.connected).map(c => c.url).join(' '));
    }
    function attach(url) {
      const c = { url, client: null, connected: false, trying: true, delay: 1500 };
      clients.push(c);
      function dial() {
        if (closed) return;
        c.trying = true; report();
        const cl = mqtt.connect(url, { clientId: `cs-${role}-${code}-${origin}-${Math.random().toString(36).slice(2, 6)}`, keepalive: 20, reconnectPeriod: 0, connectTimeout: 8000, clean: true });
        c.client = cl;
        cl.on('connect', () => { c.connected = true; c.trying = false; c.delay = 1500; cl.subscribe(sub, { qos: 0 }); report(); cl.publish(topics.hello, JSON.stringify({ role, t: Date.now(), _o: origin, _s: ++seq })); });
        cl.on('message', (topic, payload) => {
          try {
            const m = JSON.parse(payload.toString());
            // Dieselbe Nachricht kommt über jeden gemeinsamen Broker – nur die erste zählt.
            if (m._o) { const last = seen.get(m._o); if (last !== undefined && m._s <= last && last - m._s < 1e6) return; seen.set(m._o, m._s); }
            onMessage(topic.endsWith('/hello') ? 'hello' : (topic.endsWith('/ctrl') ? 'ctrl' : 'status'), m);
          } catch (e) {}
        });
        const down = () => { const was = c.connected; c.connected = false; c.trying = false; try { cl.end(true); } catch (e) {} if (c.client !== cl) return; c.client = null; report();
          if (!closed) { setTimeout(dial, c.delay); c.delay = Math.min(c.delay * 1.6, 15000); } };
        cl.on('error', down); cl.on('close', down); cl.on('offline', down);
      }
      dial();
    }
    (cfg.brokers || []).forEach(attach);
    return {
      send(obj, hello) {
        const topic = hello ? topics.hello : (role === 'station' ? topics.status : topics.ctrl);
        const s = JSON.stringify(Object.assign({}, obj, { _o: origin, _s: ++seq }));
        for (const c of clients) if (c.connected && c.client) { try { c.client.publish(topic, s, { qos: 0 }); } catch (e) {} }
      },
      close() { closed = true; for (const c of clients) { if (c.client) { try { c.client.end(true); } catch (e) {} } c.connected = false; } },
      get connected() { return clients.some(c => c.connected); },
      get brokers() { return clients.filter(c => c.connected).map(c => c.url); },
    };
  }
  window.CathSimLink = { makeCode, connect };
})();
