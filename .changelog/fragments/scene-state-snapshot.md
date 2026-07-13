feat(scene): unified state_snapshot action replacing 6 round-trips (#368)

state_snapshot action queries occupants (D1 characters), weather (weather_log), events (timeline_events), threads, environment (KV location:*), open setups (KV setup:*), and reachable locations in parallel. Returns all sections in one response.