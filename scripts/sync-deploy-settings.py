"""Install allowlisted Actions secrets and production search settings, without logging values."""
import json
import os
from pathlib import Path
import re
import sys
import tempfile


def sync(path):
    secret = os.environ.get('WAYSTORY_TAVILY_SECRET', '')
    if secret and not re.fullmatch(r'[A-Za-z0-9_-]{10,512}', secret):
        raise ValueError('Invalid Tavily secret format')
    metrics_secret = os.environ.get('WAYSTORY_METRICS_SECRET', '')
    if metrics_secret and not re.fullmatch(r'[A-Za-z0-9_-]{32,512}', metrics_secret):
        raise ValueError('Invalid metrics secret format')
    path = Path(path)
    if path.is_symlink() or not path.is_file():
        raise ValueError('Expected a regular environment file')
    original = path.read_text()
    policy = dict(reviewed=True, reviewedAt='2026-10-11',
                  termsUrl='https://www.tavily.com/terms', allowModelInput=True,
                  allowGeneratedAudio=True, allowGeneratedTextCache=True,
                  allowTextCache=False, ttlMs=0)
    updates = {
        'GLOBAL_SOURCE_DISCOVERY_ENABLED': 'true',
        'WEB_SEARCH_MAX_CALLS_PER_DAY': '10',
        'GLOBAL_WEB_USE_POLICY_JSON': "'" + json.dumps(policy, separators=(',', ':')) + "'",
    }
    # Empty Actions secrets must not erase the existing VM credential.
    if secret:
        updates['TAVILY_API_KEY'] = secret
    if metrics_secret:
        updates['METRICS_TOKEN'] = metrics_secret
    lines = []
    for line in original.splitlines(keepends=True):
        match = re.match(r'^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=', line)
        if not match or match[1] not in updates:
            lines.append(line)
    text = ''.join(lines)
    if text and not text.endswith('\n'):
        text += '\n'
    text += ''.join(f'{key}={value}\n' for key, value in updates.items())
    fd, temporary = tempfile.mkstemp(prefix='.waystory-env-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as output:
            output.write(text)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


if __name__ == '__main__':
    try:
        sync(sys.argv[1])
    except Exception:
        # Exceptions may contain input: never dump a traceback or credential.
        print('Could not install deployment settings; environment file unchanged.', file=sys.stderr)
        sys.exit(1)
    print('Deployment settings installed; credential values are not logged.')
