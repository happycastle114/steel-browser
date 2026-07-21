# Managed test fixtures

Cross-workspace contract fixtures live here. The locked upstream REST and WebSocket corpus is under
`upstream/<upstreamSha>/`; later tasks consume that committed corpus from fresh clones. The
`fixtures/runtime-scope` directory contains the portable, final-shape manager-init expected contract
used to prove source configuration at `CONFIG_BOUND`; it is not `/proc` or mount observation.

Evidence and real credentials never belong in this directory.
