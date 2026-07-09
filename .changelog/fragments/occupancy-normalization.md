### Occupancy Checking and Setup Indexing

- **Fixed occupancy checker** to normalize location references, handling variant formats like "location:marsh-emd" vs "marsh-emd"
- **Added index updates** to `plant_setup` and `pay_off_setup` handlers to maintain prefix indexes for `list_unpaid_setups` discovery
- **Improved location matching** with normalized maps built during pre-fetch for efficient validation and typo detection
