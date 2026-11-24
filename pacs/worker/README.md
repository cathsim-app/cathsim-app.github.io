# Zentrale Ergebnisablage (Cloudflare Worker + KV, kostenlos)

Gleiches Prinzip wie der Worker `cathsim-log`: Die Seite liegt auf GitHub Pages, die Bewertungen
und freigegebenen Befunde der Reader landen in einem KV-Namensraum.

Einmalig, etwa fünf Minuten:

1. `cd pacs/worker` (wrangler ist von CathSim schon installiert und angemeldet; sonst
   `npm install -g wrangler` und `wrangler login`).
2. `wrangler kv namespace create RESULTS` – die ausgegebene `id` in `wrangler.toml` eintragen.
3. `wrangler secret put STUDY_SECRET` – das Studien-Secret eingeben (dasselbe, mit dem die
   Zugänge erzeugt wurden; es steht nirgends im Repository).
4. `wrangler deploy` – gibt die Adresse aus, z. B. `https://vibepacs-log.<konto>.workers.dev`.
   Sie muss zu `endpoint` in `pacs/config/access.json` passen.

Danach zeigt die Arbeitsliste oben rechts „Ergebnis-Upload aktiv“. Abgeschickte Bewertungen
erscheinen unter Verwaltung → „Vom Server laden“ und lassen sich als CSV exportieren.

Läuft die Seite später unter einer anderen Adresse, diese in `wrangler.toml` bei `EXTRA_ORIGINS`
eintragen und neu deployen.

## Sicherheit

Jeder Zugang trägt in seinem passwortverschlüsselten Umschlag ein eigenes Upload-Kennwort
(HMAC aus Studien-Secret, Kennung und Rolle). Reader können damit nur schreiben, nur Admin-Zugänge
können Ergebnisse lesen. Wird das Secret geändert, müssen die Zugänge neu erzeugt werden.
