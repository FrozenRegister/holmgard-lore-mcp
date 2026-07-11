### Feature — world_map.render_svg: server-side SVG map export (#277)
- New `render_svg` action generates a self-contained SVG map (terrain colors from the biome registry, structure markers, zone overlays, optional highlight markers and grid labels) via pure string concatenation — no external library, no client-side rendering.
- Terrain tiles use `biomes.color_hex` from the per-world registry (#274), falling back to a legacy color map for worlds with no registered biomes, then a default gray for anything unrecognized.
- Zone overlays (#276): circles and polygons render with a semi-transparent fill; ring zones (e.g. the perimeter) render as a single dashed circle approximation rather than emitting hundreds of individual point markers — same visual read, far cheaper. `showZones`/`showPerimeter` gate rendering independently.
- `showStructures` toggles plain POI markers; a ring-shaped zone's structure row is skipped in the marker pass since its ring visual already represents it.
- `highlight` accepts custom points (e.g. Yield positions) with a label and color; `gridLabels` adds coordinate numbers along the top/left edges every 10 units.
- `getBiomeRegistry` (biome-manage.ts) now also returns `colorHex`/`movementCost` alongside `glyph` — a backward-compatible superset used by the new renderer.
