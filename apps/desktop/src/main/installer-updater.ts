import { NsisUpdater } from "electron-updater";
import { basename } from "node:path";
import type { InstallerJournal } from "./installer-diagnostics";
// Record the real detached installer handoff. A resolved spawn is not an
// installation success; only the installer's later stage log can establish that.
export class DiagnosticNsisUpdater extends NsisUpdater {
  constructor(private journal: InstallerJournal) {
    super();
  }
  protected override async spawnLog(
    cmd: string,
    args: string[] = [],
    env?: NodeJS.ProcessEnv,
    stdio: "ignore" | "inherit" = "ignore",
  ) {
    // FileFunc.GetOptions uses the option's first character as its value
    // delimiter. A '-' option would truncate a hyphenated UUID at its first '-'.
    const marker = "/CGUPDATEID=" + this.journal.attempt;
    const final = [...args];
    const installArg = final.findIndex((a) => a.startsWith("/D="));
    final.splice(installArg < 0 ? final.length : installArg, 0, marker);
    const installPath = final.find((a) => a.startsWith("/D="))?.slice(3);
    this.journal.record("installer-spawn-requested", {
      detail: basename(cmd),
      path: installPath,
      scope: installPath ? "explicit-directory" : "registry-directory",
    });
    try {
      const value = await super.spawnLog(cmd, final, env, stdio);
      this.journal.record("installer-spawn-accepted", {
        detail: basename(cmd),
      });
      return value;
    } catch (error) {
      this.journal.record("installer-spawn-failed", {
        detail: basename(cmd),
        code: (error as NodeJS.ErrnoException).code ?? "unknown",
      });
      throw error;
    }
  }
}
