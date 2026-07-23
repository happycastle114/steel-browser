import { isDeepStrictEqual } from "node:util"

import { CHROMIUM_SECCOMP_PROFILE } from "./chromium-seccomp-profile.mjs"

export const CoolifyPoolSlot = Object.freeze({
  BLUE: "BLUE",
  GREEN: "GREEN",
})

const poolBySlot = Object.freeze({
  [CoolifyPoolSlot.BLUE]: Object.freeze({
    poolId: "managed-blue-pool",
    router: "steel-managed-blue",
  }),
  [CoolifyPoolSlot.GREEN]: Object.freeze({
    poolId: "managed-green-pool",
    router: "steel-managed-green",
  }),
})

const requiredEnvironment = Object.freeze({
  managerConfig: "${STEEL_MANAGED_CONFIG_JSON:?STEEL_MANAGED_CONFIG_JSON is required}",
  routeHost: "${STEEL_MANAGED_ROUTE_HOST:?STEEL_MANAGED_ROUTE_HOST is required}",
})

const createTokenSecret = Object.freeze({
  source: "managed-create-token-key",
  target: "/run/steel-secret-source/managed-create-token-key",
  uid: "0",
  gid: "0",
  mode: 0o400,
})

const releaseEvidenceSecret = Object.freeze({
  source: "managed-release-evidence",
  target: "/run/steel-release-evidence-source/release-evidence.json",
  uid: "0",
  gid: "0",
  mode: 0o400,
})

const workerTmpfs = Object.freeze([
  "/run/steel:rw,noexec,nosuid,nodev,size=67108864,mode=0700,uid=10001,gid=10001",
  "/tmp:rw,noexec,nosuid,nodev,size=268435456,mode=1777,uid=10001,gid=10001",
  "/var/lib/steel/profile:rw,noexec,nosuid,nodev,size=268435456,mode=0700,uid=10001,gid=10001",
])

const managerTmpfs = Object.freeze([
  "/run/steel:rw,noexec,nosuid,nodev,size=1048576,mode=0700,uid=0,gid=0",
  "/tmp:rw,noexec,nosuid,nodev,size=67108864,mode=1777,uid=10001,gid=10001",
])

export function buildCoolifyCompose(input) {
  const pool = requirePool(input.poolSlot)
  requireDigestImage(input.managerImage, "manager image")
  requireDigestImage(input.workerImage, "worker image")
  requireSha256(input.releaseEvidenceSha256, "release evidence")
  const services = {
    manager: buildManager(input.managerImage, input.releaseEvidenceSha256, pool),
    "worker-00": buildWorker(input.workerImage, "worker-00"),
    "worker-01": buildWorker(input.workerImage, "worker-01"),
  }
  const compose = {
    "x-steel-managed": {
      poolId: pool.poolId,
      poolSlot: input.poolSlot,
      schemaVersion: 1,
    },
    services,
    networks: {
      coolify: { external: true, name: "coolify" },
      private: { internal: true },
    },
    secrets: {
      "managed-create-token-key": { environment: "STEEL_MANAGED_CREATE_TOKEN_KEY_HEX" },
      "managed-release-evidence": { environment: "STEEL_MANAGED_RELEASE_EVIDENCE_JSON" },
    },
  }
  verifyCoolifyCompose(compose)
  return compose
}

export function serializeCoolifyCompose(compose) {
  verifyCoolifyCompose(compose)
  return `${JSON.stringify(compose, null, 2)}\n`
}

export function verifyCoolifyCompose(compose) {
  if (!isRecord(compose) || !isRecord(compose.services) || !isRecord(compose["x-steel-managed"])) {
    throw new TypeError("invalid Coolify Compose document")
  }
  const metadata = compose["x-steel-managed"]
  const pool = requirePool(metadata.poolSlot)
  if (metadata.poolId !== pool.poolId || metadata.schemaVersion !== 1) {
    throw new TypeError("Coolify pool metadata drift")
  }
  const serviceNames = Object.keys(compose.services)
  if (!isDeepStrictEqual(serviceNames, ["manager", "worker-00", "worker-01"])) {
    throw new TypeError("Coolify service inventory drift")
  }
  const manager = requireService(compose.services.manager)
  const workerZero = requireService(compose.services["worker-00"])
  const workerOne = requireService(compose.services["worker-01"])
  requireDigestImage(manager.image, "manager image")
  verifyManager(manager, pool)
  verifyWorker(workerZero, "worker-00")
  verifyWorker(workerOne, "worker-01")
  if (workerZero.image !== workerOne.image) throw new TypeError("worker image drift")
  requireDigestImage(workerZero.image, "worker image")
  if (!isDeepStrictEqual(compose.networks, {
    coolify: { external: true, name: "coolify" },
    private: { internal: true },
  })) throw new TypeError("Coolify network drift")
  if (!isDeepStrictEqual(compose.secrets, {
    "managed-create-token-key": { environment: "STEEL_MANAGED_CREATE_TOKEN_KEY_HEX" },
    "managed-release-evidence": { environment: "STEEL_MANAGED_RELEASE_EVIDENCE_JSON" },
  })) throw new TypeError("Coolify secret source drift")
  return Object.freeze({ poolId: pool.poolId })
}

function buildManager(image, releaseEvidenceSha256, pool) {
  return {
    image,
    command: [
      "/usr/local/bin/steel-managed-manager",
      `--pool-id=${pool.poolId}`,
      "--worker=worker-00=http://worker-00:3000",
      "--worker=worker-01=http://worker-01:3000",
      "--public-bind=0.0.0.0:3000",
      "--health-bind=127.0.0.1:3001",
      "--create-token-key-file=/run/steel/managed-create-token-key",
      "--release-evidence-file=/run/steel/managed-release-evidence.json",
      `--release-evidence-sha256=${releaseEvidenceSha256}`,
    ],
    environment: { STEEL_MANAGED_CONFIG_JSON: requiredEnvironment.managerConfig },
    secrets: [createTokenSecret, releaseEvidenceSecret],
    // Docker Compose cannot materialize environment-backed secrets for a
    // read-only service. The scratch image remains root-owned, and PID 1 drops
    // to the capability-free runtime UID before starting Node.
    read_only: false,
    tmpfs: managerTmpfs,
    cap_drop: ["ALL"],
    cap_add: ["CHOWN", "SETGID", "SETPCAP", "SETUID"],
    security_opt: ["no-new-privileges:true"],
    pids_limit: 256,
    mem_limit: "512m",
    mem_reservation: "256m",
    stop_grace_period: "90s",
    restart: "unless-stopped",
    depends_on: {
      "worker-00": { condition: "service_healthy" },
      "worker-01": { condition: "service_healthy" },
    },
    networks: ["coolify", "private"],
    labels: [
      "traefik.enable=true",
      "traefik.docker.network=coolify",
      `traefik.http.routers.${pool.router}.entrypoints=https`,
      `traefik.http.routers.${pool.router}.rule=Host(\`${requiredEnvironment.routeHost}\`)`,
      `traefik.http.routers.${pool.router}.tls=true`,
      `traefik.http.services.${pool.router}.loadbalancer.server.port=3000`,
    ],
  }
}

function buildWorker(image, workerId) {
  return {
    image,
    environment: { MANAGED_WORKER_ID: workerId },
    user: "10001:10001",
    read_only: true,
    tmpfs: workerTmpfs,
    cap_drop: ["ALL"],
    security_opt: [
      "no-new-privileges:true",
      `seccomp=${CHROMIUM_SECCOMP_PROFILE.deploymentPath}`,
    ],
    pids_limit: 512,
    shm_size: "512m",
    mem_limit: "2560m",
    mem_reservation: "1280m",
    stop_grace_period: "60s",
    restart: "unless-stopped",
    networks: ["private"],
  }
}

function verifyManager(manager, pool) {
  if ("ports" in manager || "expose" in manager || "privileged" in manager) {
    throw new TypeError("manager exposure drift")
  }
  const expected = buildManager(
    manager.image,
    requireCommandDigest(manager.command),
    pool,
  )
  if (!isDeepStrictEqual(manager, expected)) throw new TypeError("manager service drift")
}

function verifyWorker(worker, workerId) {
  if ("ports" in worker || "expose" in worker || "secrets" in worker || "privileged" in worker) {
    throw new TypeError("worker isolation drift")
  }
  if (!isDeepStrictEqual(worker, buildWorker(worker.image, workerId))) {
    throw new TypeError("worker service drift")
  }
}

function requireCommandDigest(command) {
  if (!Array.isArray(command)) throw new TypeError("manager command missing")
  const prefix = "--release-evidence-sha256="
  const argument = command.find((value) => typeof value === "string" && value.startsWith(prefix))
  if (argument === undefined) throw new TypeError("release evidence argument missing")
  const digest = argument.slice(prefix.length)
  requireSha256(digest, "release evidence")
  return digest
}

function requirePool(slot) {
  const pool = poolBySlot[slot]
  if (pool === undefined) throw new TypeError("invalid Coolify pool slot")
  return pool
}

function requireService(value) {
  if (!isRecord(value)) throw new TypeError("invalid Coolify service")
  return value
}

function requireDigestImage(value, field) {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9._/-]*@sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new TypeError(`${field} must be digest-pinned`)
  }
}

function requireSha256(value, field) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) {
    throw new TypeError(`${field} must be SHA-256`)
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
