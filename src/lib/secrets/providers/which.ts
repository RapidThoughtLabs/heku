import fs from "node:fs";
import path from "node:path";

/**
 * Zero-dep PATH lookup. Lets an OS-keychain adapter's `isAvailable()` check for its
 * backend binary (`security`, `secret-tool`, `powershell`) without shelling out.
 */
export function isOnPath(cmd: string): boolean {
  const pathEnv = process.env.PATH ?? "";
  const exts = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, cmd + ext);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return true;
      } catch {
        continue;
      }
    }
  }
  return false;
}
