# Escher-Parkett

Tablet-App (PWA) für die Klassen 4–10: Kinder entwerfen eigene Escher-Puzzlestücke.
Das Stück füllt die Ebene immer lückenlos, weil alles, was an einer Kante angebaut
wird, an der zugehörigen Kante weggenommen wird.

## Ablauf

1. **Parkett wählen:**
   - Die 11 archimedischen Parkette sind wie im Unterricht nummeriert, von Parkett 1 (3,3,3,3,3,3) bis Parkett 11 (6,6,6).
   - Bisher gibt es Parkett 7 (4,4,4,4).
2. **Symmetrie wählen:**
   - *Verschieben*
   - *Drehen um die Kantenmitte*
   - *Drehen um die Ecke*, nur beim Quadrat
   - Kanten, die zusammengehören, haben dieselbe Farbe.
3. **Raster einstellen:**
   - Die Punkte a und b lassen sich ziehen.
   - Schnellwahl: Quadrat, Rechteck, Raute oder Parallelogramm.
   - Optional mit Hilfsgitter.
4. **Fliese bearbeiten:** Anbauen oder Anknabbern, freihand oder mit einrastenden Formen.
5. **Gestalten, Anzeigen, Drucken:**
   - Farbe und Malen.
   - Die Fläche füllen, alle gleich oder abwechselnd.
   - Schablone und Fläche in echter Größe drucken.

Der Stand wird automatisch im Browser gespeichert. Rückgängig geht mit Strg+Z.
Nach dem ersten Besuch funktioniert die App auch offline und lässt sich auf dem
Tablet zum Home-Bildschirm hinzufügen.

## Entwicklung

```sh
npm install
npm run dev      # Entwicklungsserver
npm test         # Geometrie-Tests
npm run build    # statische Seite in dist/
```

Bei jedem Push auf `main` testet und baut GitHub Actions die App und veröffentlicht
sie auf GitHub Pages. Dafür muss einmalig unter *Settings → Pages → Source*
„GitHub Actions“ ausgewählt sein.

## Aufbau

- `src/core/`: Geometrie
  - `geom.ts`: Punkte, Bewegungen, Boolesche Operationen mit polygon-clipping auf ganzzahligen Koordinaten.
  - `tile.ts`: Anbauen und Anknabbern mit Prüfungen.
- `src/parquets/`: Parkett-Typen und Symmetrien als Daten (`types.ts`)
  - `square.ts`: Parkett 7.
  - `archimedean.ts`: erzeugt die 11 Parkette aus ihrem Ecken-Typ, für die Vorschaubilder und später für weitere Parkette.
- `src/model/`: Dokument, Verlauf (Rückgängig/Wiederholen), Raster-Regeln.
- `src/render/`: SVG für Bildschirm und Druck.
- `src/ui/`: React-Oberfläche.
