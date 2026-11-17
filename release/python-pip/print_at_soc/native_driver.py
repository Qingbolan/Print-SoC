"""Installation launcher only. All system print processing lives in the Rust app."""
from pathlib import Path
import os
import subprocess
import sys
from .downloader import get_binary_path

LABEL = 'tech.silan.PrintAtSoC.print-service'

def launch(command, arguments):
    executable = get_binary_path()
    if not executable.is_file():
        raise RuntimeError('Install the desktop app first: print-soc app install. Its Rust driver is embedded; no Python print service is installed.')
    # Reject an older desktop before it can interpret driver arguments as GUI launch.
    result = subprocess.run([str(executable), '--native-driver-self-test'], capture_output=True, text=True, timeout=10)
    if result.returncode or 'Rust native driver protocol 1' not in result.stdout:
        raise RuntimeError('This desktop does not include the native driver. Update the desktop app first.')
    return subprocess.run([str(executable), command, *arguments]).returncode

def service_path(home=None, system=None):
    home = Path(home or Path.home())
    if (system or sys.platform) in ('Darwin', 'darwin'):
        return home / 'Library/LaunchAgents' / (LABEL + '.plist')
    return home / '.config/systemd/user' / (LABEL + '.service')

def stop_service(home=None, system=None):
    agent = service_path(home, system)
    if not agent.exists():
        return
    if (system or sys.platform) in ('Darwin', 'darwin'):
        domain = 'gui/' + str(os.getuid())
        status = subprocess.run(['launchctl', 'print', domain + '/' + LABEL], capture_output=True)
        if status.returncode == 113:
            agent.unlink()
            return
        command = ['launchctl', 'bootout', domain, str(agent)]
    else:
        command = ['systemctl', '--user', 'disable', '--now', agent.name]
    result = subprocess.run(command, capture_output=True)
    if result.returncode:
        raise RuntimeError('Could not stop the native printing service; log in as its owner and retry.')
    agent.unlink()
