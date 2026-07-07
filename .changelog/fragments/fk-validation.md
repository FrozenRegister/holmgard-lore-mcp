### FK Constraint Validation for D1 Insert Operations

- **Fixed:** D1 insert operations now validate foreign key (FK) constraints before attempting INSERT, returning proper JSON-RPC -32602 errors instead of raw 500 errors when FK targets don't exist
- **Impact:** `append_event`, `set_entity_knowledge`, and `learn_from_event` handlers now pre-validate that referenced entities (worlds, characters, timeline_events) exist before inserting, providing clear error messages when references are broken
- **Resolves:** #224
