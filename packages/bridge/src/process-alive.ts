/**
 * Real OS process alive check using kill(pid, 0).
 * Signal 0 tests process existence without sending an actual signal.
 */
export function isProcessAlive(pid: number | undefined | null): boolean {
  if (pid == null) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    // ESRCH = no such process (dead)
    // EPERM = process exists but we lack permission (still alive!)
    return err?.code === 'EPERM';
  }
}
