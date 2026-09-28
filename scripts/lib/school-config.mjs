import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Search portals are user/institution-specific. There is no universal WoS URL.
export const DEFAULT_DISCOVERY_URL = null;

export function configPathFromEnv(env = process.env) {
  const dir = env.LIT_DL_CONFIG_DIR || path.join(os.homedir(), ".config", "lit-dl");
  return path.join(dir, "school.json");
}

export function profilePathFromEnv(env = process.env) {
  const dir = env.LIT_DL_CONFIG_DIR || path.join(os.homedir(), ".config", "lit-dl");
  return path.join(dir, "profile.json");
}

export function loadSchoolConfig(env = process.env) {
  // profile.json is the portable v2 configuration. Keep the legacy school.json
  // readable so existing users are not silently migrated or overwritten.
  for (const file of [profilePathFromEnv(env), configPathFromEnv(env)]) {
    if (!fs.existsSync(file)) continue;
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      if (file.endsWith("profile.json")) throw new Error(`Invalid profile JSON: ${file}`);
    }
  }
  return null;
}

export function discoveryUrlFromConfig(config) {
  return (
    config?.access?.discovery_url ||
    config?.discovery?.web_of_science_url ||
    config?.discovery?.wos_url ||
    config?.discovery?.url ||
    DEFAULT_DISCOVERY_URL
  );
}

export function schoolSummary(config) {
  if (!config) return "unconfigured";
  if (config.version === 2) {
    return config.access?.institution?.name || "no institution (open access)";
  }
  const school = config.school?.name || "unknown school";
  const auth = config.auth?.type || "unknown auth";
  return `${school} (${auth})`;
}
