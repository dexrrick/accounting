# Gemini live diagnostic — 09/10/2026

Four of nine cases passed every diagnostic stage. Five were NOT_ASSESSED because no usable model response arrived: four exhausted both 8-second attempts; foreign-dividend receipt returned HTTP503 on both attempts. There were16 dispatch attempts:4 HTTP200,10 timeouts,2 HTTP503, with7 scheduled retries. No network guard violations or new official-source requests occurred. All52 protected historical files and9 recorded code files stayed unchanged during the run.

Every available response passed. The false downstream verdicts on unavailable cases must not be interpreted as invalid model output or matching failures. The final subsidiary-descriptor repair remains verified offline; this run could not verify it live because its provider requests returned503.

The4 successful attempts took6869,7285,7541 and7678 milliseconds. These approach the8-second cutoff. A longer bounded attempt budget is a reasonable next experiment; the censored timeouts do not establish whether delay arose from provider load or the network, nor whether those requests would eventually succeed. HTTP503 is separately recorded service unavailability. Google's [troubleshooting guide](https://ai.google.dev/gemini-api/docs/troubleshooting) recommends capped retries with backoff and jitter for transient errors.

Earlier repeatable semantic failures came from literal title matching and treating background descriptors as independent requested outcomes. Those were repaired using explicit original-question facts and validated issue scope, with negative direction, population, registration, topic and separate-outcome controls. This latest batch supplies no evidence that missing reference documents caused the failures: it failed before usable interpretations were available.

This consumed run remains4 passes and5 unassessed after subsequent repairs. Never reuse this directory or relabel its outcomes. Source evidence is retained capture replay referenced to08/10/2026. Fresh official-source availability and canonical acceptance were not assessed; diagnostic passes include correct unresolved-fact and unsupported-coverage handling.
