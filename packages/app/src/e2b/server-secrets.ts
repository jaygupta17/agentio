// Vault-backed secret store for server connections. The persisted server
// list keeps urls/names only; Basic credentials live exclusively in the
// AES-GCM device vault (vault.ts `servers` map) and are merged into the
// in-memory connections at boot. localStorage never sees a password.
import { loadVault, updateVault, type VaultServerCreds } from "./vault"

export async function loadServerSecrets(): Promise<Record<string, VaultServerCreds>> {
  const vault = await loadVault().catch(() => null)
  return vault?.servers ?? {}
}

export function serverSecretStore() {
  return {
    save(url: string, creds: VaultServerCreds) {
      return updateVault((v) => ({ ...v, servers: { ...v.servers, [url]: creds } }))
    },
    remove(url: string) {
      return updateVault((v) => {
        const servers = { ...v.servers }
        delete servers[url]
        return { ...v, servers }
      })
    },
  }
}
