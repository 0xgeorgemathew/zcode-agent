'use strict';
// Child process groups that must not outlive this process: engines and
// checks are spawned detached (their own group, so one kill takes the whole
// tree) and are normally killed where they are awaited. This registry is the
// backstop for every other way out (a second Ctrl-C's process.exit, an
// uncaught error): at 'exit' whatever is still tracked is killed, so an
// engine in yolo mode never keeps running tools with nothing to stop it.
// Detached workers and plan supervisors are meant to outlive their parent
// and are never tracked.
const tracked = new Set();
let installed = false;

function killAll() {
  for (const pid of tracked) {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
  }
  tracked.clear();
}

// Registers a process-group id; returns the function that forgets it.
function track(pid) {
  if (!pid) return () => {};
  if (!installed) {
    installed = true;
    process.on('exit', killAll);
  }
  tracked.add(pid);
  return () => tracked.delete(pid);
}

module.exports = { track, killAll };
