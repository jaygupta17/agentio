// agentio launcher fork — copied verbatim from `app/web/src/lib/vault.ts`.
// Device vault — AES-GCM envelope around BYOK secrets, keyed by a
// non-extractable device key in IndexedDB. Secrets at rest are never
// plaintext localStorage (the foundation shortcut this replaces).
//
// Threat model (honest): page JS can always *use* the key while unlocked,
// so this defeats at-rest theft (stolen disk, other origins, shoulder
// localStorage dumps) — not a compromised page. XSS discipline (no
// innerHTML, text-only rendering, CSP) is the other half.

export interface VaultServerCreds {
  username?: string
  password: string
  /** E2B sandbox this serve URL belongs to (enables the file-backed
   * config features; absent for manually connected servers). */
  sandboxId?: string
}

export interface VaultSecrets {
  /** opencode serve Basic password (per-device generated) */
  password: string
  /** E2B API key (BYOK cloud) */
  e2bKey: string
  /** provider -> API key, e.g. {anthropic: "sk-..."} */
  llmKeys: Record<string, string>
  /** serve Basic credentials per saved server URL (the only secret home
   * for persisted servers — never localStorage) */
  servers: Record<string, VaultServerCreds>
}

export const EMPTY_VAULT: VaultSecrets = { password: "", e2bKey: "", llmKeys: {}, servers: {} }

export interface VaultBackend {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
  del(key: string): Promise<void>
}

const DB_NAME = "agentio-vault"
const STORE = "kv"
const DEK_RECORD = "dek"
const VAULT_RECORD = "vault"

function openDb(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function tx<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode)
    const req = fn(t.objectStore(STORE))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

let vaultDb: Promise<IDBDatabase> | null = null

export function idbBackend(): VaultBackend {
  const db = () => (vaultDb ??= openDb(DB_NAME))
  return kvBackend(db)
}

/** Generic IDB key-value backend for other stores (offline cache, …). */
export function idbKvBackend(dbName: string): VaultBackend {
  let db: Promise<IDBDatabase> | null = null
  const get = () => (db ??= openDb(dbName))
  return kvBackend(get)
}

function kvBackend(getDb: () => Promise<IDBDatabase>): VaultBackend {
  return {
    get: async (key) => tx(await getDb(), "readonly", (s) => s.get(key)),
    set: async (key, value) => {
      await tx(await getDb(), "readwrite", (s) => s.put(value, key))
    },
    del: async (key) => {
      await tx(await getDb(), "readwrite", (s) => s.delete(key))
    },
  }
}

export function memoryBackend(): VaultBackend {
  const map = new Map<string, unknown>()
  return {
    get: async (key) => map.get(key),
    set: async (key, value) => {
      map.set(key, value)
    },
    del: async (key) => {
      map.delete(key)
    },
  }
}

async function deviceKey(backend: VaultBackend): Promise<CryptoKey> {
  const existing = await backend.get(DEK_RECORD)
  if (existing instanceof CryptoKey) return existing
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ])
  await backend.set(DEK_RECORD, key)
  return key
}

const b64 = {
  encode(bytes: Uint8Array): string {
    let s = ""
    for (const b of bytes) s += String.fromCharCode(b)
    return btoa(s)
  },
  decode(s: string): Uint8Array<ArrayBuffer> {
    const bin = atob(s)
    const out = new Uint8Array(new ArrayBuffer(bin.length))
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  },
}

export async function saveVault(
  secrets: VaultSecrets,
  backend: VaultBackend = idbBackend(),
): Promise<void> {
  const key = await deviceKey(backend)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(secrets)),
  )
  await backend.set(VAULT_RECORD, {
    iv: b64.encode(iv),
    data: b64.encode(new Uint8Array(data)),
  })
}

export async function loadVault(
  backend: VaultBackend = idbBackend(),
): Promise<VaultSecrets | null> {
  const rec = (await backend.get(VAULT_RECORD)) as
    | { iv: string; data: string }
    | undefined
  if (!rec) return null
  try {
    const key = await deviceKey(backend)
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64.decode(rec.iv) },
      key,
      b64.decode(rec.data),
    )
    const parsed: unknown = JSON.parse(new TextDecoder().decode(plain))
    if (!parsed || typeof parsed !== "object") return null
    const o = parsed as Record<string, unknown>
    const servers: Record<string, VaultServerCreds> = {}
    if (o.servers && typeof o.servers === "object") {
      for (const [url, creds] of Object.entries(o.servers as Record<string, unknown>)) {
        if (!creds || typeof creds !== "object") continue
        const c = creds as Record<string, unknown>
        if (typeof c.password !== "string" && c.password !== undefined) continue
        const sandboxId = typeof c.sandboxId === "string" && c.sandboxId ? c.sandboxId : undefined
        if (!c.password && !sandboxId) continue
        servers[url] = {
          password: typeof c.password === "string" ? c.password : "",
          ...(typeof c.username === "string" && c.username ? { username: c.username } : {}),
          ...(typeof c.sandboxId === "string" && c.sandboxId ? { sandboxId: c.sandboxId } : {}),
        }
      }
    }
    return {
      password: typeof o.password === "string" ? o.password : "",
      e2bKey: typeof o.e2bKey === "string" ? o.e2bKey : "",
      llmKeys:
        o.llmKeys && typeof o.llmKeys === "object"
          ? Object.fromEntries(
              Object.entries(o.llmKeys as Record<string, unknown>).filter(
                (e): e is [string, string] => typeof e[1] === "string",
              ),
            )
          : {},
      servers,
    }
  } catch {
    return null
  }
}

/**
 * Read-modify-write the vault in one step. Whole-record saves must go through
 * here (or build on a fresh load) so concurrent writers — e.g. the Cloud tab
 * remembering keys while a connect stores server creds — don't clobber each
 * other's fields.
 */
export async function updateVault(
  fn: (secrets: VaultSecrets) => VaultSecrets,
  backend: VaultBackend = idbBackend(),
): Promise<void> {
  const current = (await loadVault(backend)) ?? EMPTY_VAULT
  await saveVault(fn(current), backend)
}

export async function clearVault(
  backend: VaultBackend = idbBackend(),
): Promise<void> {
  await backend.del(VAULT_RECORD)
}

/** URL-safe random secret for the per-device serve password. */
export function generatePassword(bytes = 32): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes))
  return b64.encode(buf).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

/**
 * Assemble OPENCODE_AUTH_CONTENT from the keys map. Memory-only by design:
 * call at sandbox-start time, never persist the JSON. Matches the server
 * auth schema ({provider: {type:"api", key}}) verified in reference auth/.
 */
export function buildAuthContent(llmKeys: Record<string, string>): string {
  const out: Record<string, { type: "api"; key: string }> = {}
  for (const [provider, key] of Object.entries(llmKeys)) {
    const p = provider.trim()
    const k = key.trim()
    if (p && k) out[p] = { type: "api", key: k }
  }
  return JSON.stringify(out)
}
