import contextlib
import importlib.util
import io
from pathlib import Path
import stat
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('migration', Path(__file__).resolve().parents[1] / 'scripts/import-yandex-settings.py')
migration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)


class MigrationTest(unittest.TestCase):
    def test_copies_only_credentials_preserving_owner_and_other_settings(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / '.env'
            target.write_text("YANDEX_API_KEY='old'\nYANDEX_STORY_MODEL=custom\nOTHER=preserved\n")
            owner = target.stat().st_uid
            stdout = io.StringIO()
            response = subprocess.CompletedProcess([], 0, '["YANDEX_API_KEY=new-secret", "YANDEX_FOLDER_ID=folder", "UNRELATED_SECRET=never-copy"]')
            with patch.object(migration, 'Path', return_value=target), patch.object(migration.os, 'geteuid', return_value=0), patch.object(migration.subprocess, 'run', return_value=response), contextlib.redirect_stdout(stdout):
                migration.main()
            text = target.read_text()
            self.assertIn("YANDEX_API_KEY='new-secret'", text)
            self.assertIn('YANDEX_STORY_MODEL=custom', text)
            self.assertIn('OTHER=preserved', text)
            self.assertNotIn('never-copy', text)
            self.assertNotIn('new-secret', stdout.getvalue())
            self.assertEqual(target.stat().st_uid, owner)
            self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o600)

    def test_missing_credentials_leave_original_file_untouched(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / '.env'
            target.write_text('KEEP=original\n')
            response = subprocess.CompletedProcess([], 0, '["YANDEX_API_KEY=key"]')
            with patch.object(migration, 'Path', return_value=target), patch.object(migration.os, 'geteuid', return_value=0), patch.object(migration.subprocess, 'run', return_value=response):
                with self.assertRaises(SystemExit):
                    migration.main()
            self.assertEqual(target.read_text(), 'KEEP=original\n')


if __name__ == '__main__':
    unittest.main()
