# Security Threat Model (STRIDE)

This threat model identifies potential security threats against the HAIF inference network and outlines mitigations following the STRIDE methodology.

## Spoofing

### Threats
- An attacker impersonates a legitimate Worker or Orchestrator to inject malicious responses or steal requests.

### Mitigations
- All nodes use Curve/Noise keypairs; announcements and RPC messages are signed and verified.
- Clients and Workers authenticate via API tokens validated at the Gateway.
- Heartbeat messages include nonces and signatures to prevent replay.

## Tampering

### Threats
- Alteration of model artifacts or messages in transit.

### Mitigations
- Model artifacts are content‑addressed by SHA‑256 digest and signed; Workers verify signatures before loading.
- Transport encryption via **HTTPS/TLS** protects HTTP channels from eavesdropping and tampering; **Hyperswarm RPC** streams are authenticated and can be payload‑encrypted per tenant policy.
- Metadata updates (jobs, quotas, reservations) are persisted in a strongly consistent store.

## Repudiation

### Threats
- Nodes deny sending or receiving messages; Clients dispute inference results.

### Mitigations
- All RPC requests include correlation IDs and retry tokens; the Orchestrator persists reservations and job states.
- Audit logs and traces are exported via OpenTelemetry for forensic analysis.
- The Metadata Store records finalization of each job, enabling evidence for billing and auditing.

## Information Disclosure

### Threats
- Sensitive model weights or user inputs/results are exposed to unauthorized parties.

### Mitigations
- Workers fetch encrypted and signed model artifacts; unauthorized Workers cannot decrypt them.
- Per‑tenant API tokens and quotas enforce access control at the Gateway and Orchestrator.
- Optional end‑to‑end payload encryption is supported per tenant.

## Denial of Service

### Threats
- Adversaries flood the network with requests or cause resource exhaustion on Workers.

### Mitigations
- The Gateway enforces per‑tenant token‑bucket rate limits; the Orchestrator monitors Worker queue depth and sheds requests when thresholds are exceeded.
- Circuit breakers trip for models/regions with high error or latency rates, isolating failures.
- The DLQ captures failed jobs; backoff and retry logic prevents cascading retries.

## Elevation of Privilege

### Threats
- Attackers exploit software bugs in Workers or Orchestrators to gain unauthorized access or higher privileges.

### Mitigations
- Services run with least privilege, using container isolation and sandboxing.
- Model execution paths are restricted; dynamic loading of user‑supplied code is not allowed.
- The policy engine enforces quotas and denies unauthorized model version execution.