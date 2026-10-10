#!/usr/bin/env python3
"""On the VM, copy only Yandex credentials from dogovorovoi to Waystory."""
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile


def main():
    if os.geteuid() != 0:
        raise SystemExit('Run with sudo on the VM.')
    target = Path('/opt/waystory/.env')
    if not target.is_file() or target.is_symlink():
        raise SystemExit('Expected an existing regular /opt/waystory/.env file.')
    result = subprocess.run(
        ['docker', 'inspect', 'dogovorovoi-api-1', '--format', '{{json .Config.Env}}'],
        check=True, capture_output=True, text=True,
    )
    container_env = dict(item.split('=', 1) for item in json.loads(result.stdout) if '=' in item)
    names = ('YANDEX_API_KEY', 'YANDEX_FOLDER_ID')
    values = {name: container_env.get(name, '') for name in names}
    # Yandex credential characters are safe in quoted dotenv values. Refuse
    # unexpected formats instead of changing or printing a credential.
    if any(not re.fullmatch(r'[A-Za-z0-9._-]+', value) for value in values.values()):
        raise SystemExit('Yandex credentials are missing or have an unexpected format; no changes made.')
    previous = target.stat()
    lines = [line for line in target.read_text().splitlines()
             if not re.match(r'^\s*(?:export\s+)?(?:YANDEX_API_KEY|YANDEX_FOLDER_ID)\s*=', line)]
    lines.extend(f"{name}='{values[name]}'" for name in names)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', dir=target.parent, delete=False) as output:
            temporary = output.name
            os.fchmod(output.fileno(), 0o600)
            os.fchown(output.fileno(), previous.st_uid, previous.st_gid)
            output.write('\n'.join(lines) + '\n')
        os.replace(temporary, target)
        temporary = None
    finally:
        if temporary:
            os.unlink(temporary)
    print('Copied YANDEX_API_KEY and YANDEX_FOLDER_ID. Values hidden; file owner preserved.')


if __name__ == '__main__':
    main()
