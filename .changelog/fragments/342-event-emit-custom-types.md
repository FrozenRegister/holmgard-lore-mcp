# Fix event.emit to accept custom event types

- Changed `event.emit` to accept any string as eventType instead of a closed enum
- Expanded KNOWN_EVENT_TYPES to include production-specific types: crate_drop, perimeter_contraction, audience_vote, production_intervention, predator_release, shelter_collapse, weather_shift, echo_activation
- Updated list_types action to indicate that custom event types are permitted (fixes #342)
