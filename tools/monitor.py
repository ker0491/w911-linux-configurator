#!/usr/bin/env python3
"""Print raw HID reports from the W911 for a while.

Usage: python3 tools/monitor.py [seconds]

Finds the three HID interfaces of the keyboard (USB b6a4:4100) no matter which
/dev/hidraw numbers they got, then prints every report. Use it when a key, the
knob or the roller seems to do nothing. It only reads; nothing is written.
"""
import os
import select
import sys
import time

SECONDS = int(sys.argv[1]) if len(sys.argv) > 1 else 120
VID_PID = "B6A4:4100"


def w911_hidraw_paths():
    paths = []
    root = "/sys/class/hidraw"
    try:
        names = sorted(os.listdir(root))
    except OSError:
        return paths
    for name in names:
        uevent = os.path.join(root, name, "device", "uevent")
        try:
            text = open(uevent, encoding="utf-8").read()
        except OSError:
            continue
        if VID_PID in text.upper():
            paths.append("/dev/" + name)
    return paths


paths = w911_hidraw_paths()
if not paths:
    sys.exit("No W911 HID interfaces found (expected USB b6a4:4100). Is the keyboard plugged in?")

print("# W911 interfaces: " + ", ".join(paths), flush=True)
fds = {}
for p in paths:
    try:
        fds[os.open(p, os.O_RDONLY | os.O_NONBLOCK)] = p
    except OSError as e:
        print(f"# {p}: {e}", flush=True)
if not fds:
    sys.exit("Could not open any interface. Install the udev rule and replug the keyboard.")

end = time.time() + SECONDS
print(f"# listening for {SECONDS}s; turn the knob/roller and press the joystick centre", flush=True)
try:
    while time.time() < end:
        ready, _, _ = select.select(list(fds), [], [], 0.5)
        for fd in ready:
            try:
                data = os.read(fd, 128)
            except BlockingIOError:
                continue
            if data:
                print(f"{time.time():.3f} {fds[fd]} {data.hex(' ')}", flush=True)
finally:
    for fd in fds:
        os.close(fd)
