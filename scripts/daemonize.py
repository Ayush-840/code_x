#!/usr/bin/env python3
"""Double-fork daemonizer: run CMD detached in its own session, logging to a file.

Usage: python3 scripts/daemonize.py LOGFILE CMD [ARGS...]

The child calls setsid() so it survives the launching terminal/closing shell —
plain `nohup ... &` children keep the launcher's process group and get torn
down with it, which is how the dev stack kept silently dying.
"""
import os
import subprocess
import sys


def main() -> None:
    if len(sys.argv) < 3:
        sys.exit("usage: daemonize.py LOGFILE CMD [ARGS...]")
    log = open(sys.argv[1], "ab", 0)
    pid = os.fork()
    if pid == 0:
        os.setsid()
        subprocess.Popen(
            sys.argv[2:],
            stdout=log,
            stderr=log,
            stdin=subprocess.DEVNULL,
            start_new_session=True,
        )
        os._exit(0)
    os.waitpid(pid, 0)


if __name__ == "__main__":
    main()
