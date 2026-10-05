# Escher-Parkett

Browser-App, mit der Schülerinnen und Schüler eine Fliese im Stil von M. C. Escher
gestalten. Die Fliese füllt die Fläche immer lückenlos. Sie läuft am PC und auf dem
Tablet (Touch und Stift).

## Ablauf

1. **Parkett wählen:** Bisher gibt es (4,4,4,4), das Quadratgitter.
2. **Raster und Symmetrie:**
   - Symmetrie wählen:
     - *Verschieben*
     - *Drehen um die Kantenmitte (180°)*
     - *Drehen um die Ecke (90°)*, nur beim Quadrat
   - Rasterform wählen: Quadrat, Rechteck oder Parallelogramm. Die Form stellt man über die roten Punkte ein.
3. **Fliese bearbeiten:**
   - *Hinzufügen* oder *Anknabbern*, freihand oder mit Kreis, Dreieck oder Rechteck. Diese Formen rasten am Rand ein.
   - Die Gegenkante ändert sich automatisch mit.
4. **Gestalten:** Die Fliese einfärben und mit dem Stift Augen und Muster aufmalen.
5. **Anzeigen:** Die Fläche füllen, wahlweise einfarbig, im Schachbrett oder mit einer Farbe je Drehung.
6. **Ausgabe:**
   - Kantenlänge in cm einstellen.
   - Drucken oder als PDF speichern: Schablone zum Ausschneiden und/oder eine gefüllte A4-Seite.
   - Beides gibt es auch als SVG.

Der Stand wird automatisch im Browser gespeichert. Rückgängig geht mit Strg+Z.

## Entwicklung

```sh
npm install
npm run dev      # Entwicklungsserver
npm test         # Geometrie-Tests (Parkettierung bleibt lückenlos)
npm run build    # statische Seite in dist/
```

## Aufbau

- `src/geom.ts`: Punkte, affine Abbildungen und Flächen-Boolesche Operationen (polygon-clipping, ganzzahlige Koordinaten).
- `src/symmetry.ts`: Raster und Symmetriegruppen. Für jede Symmetrie gibt es die vier Abbildungen auf die Kantennachbarn, alle anderen Kopien entstehen durch Verketten.
- `src/tile.ts`:
  - *Hinzufügen*: Was in eine Nachbarfliese ragt, wird an der Urbild-Stelle abgezogen.
  - *Anknabbern*: Das abgeknabberte Stück geht an den Nachbarn.
  - So bleibt die Fliese immer parkettierbar.
- `src/render.ts`, `src/print.ts`, `src/main.ts`: Darstellung, Druck und Oberfläche.
