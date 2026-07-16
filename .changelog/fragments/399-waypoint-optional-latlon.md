### rpg waypoint: lat/lon optional for non-geo-calibrated worlds (#399)

- `waypoints.lat`/`lon` are now nullable (migration `0037_waypoint_lat_lon_optional.sql`, table-rebuild pattern). `q`/`r` (hex coordinates) remain required unconditionally.
- `rpg{sub:"waypoint", action:"register"}` only requires `lat`/`lon` when the target world has been geo-calibrated (`waypoint.calibrate`) — a purely grid/hex world can register without them, storing `null` instead of fabricated placeholder coordinates. Calibrated worlds still require `lat`/`lon` on `register`.
- Deferred edge case from #341; scoped as a schema/validation judgment call per the issue's own framing, with the design it proposed.
