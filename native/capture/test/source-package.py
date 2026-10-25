import importlib.util
import pathlib
import tempfile
import unittest
import zipfile


class SourceDistributionTest(unittest.TestCase):
    def test_source_is_downloadable_separately_and_absent_from_runtime(self):
        script = pathlib.Path(__file__).resolve().parents[1] / "source-package.py"
        self.assertTrue(script.is_file(), "Source distribution needs an independent packager")
        spec = importlib.util.spec_from_file_location("source_package", script)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            runtime = root / "runtime"
            runtime.mkdir()
            source = root / "source"
            source.mkdir()
            (source / "host.cpp").write_text("// corresponding source")
            (source / "vendor.tar.gz").write_bytes(b"pinned upstream archive")
            archive = root / "CineGather-0.1.9-win-x64-native-source.zip"
            info = module.package_sources(source, runtime, archive)
            self.assertFalse((runtime / "source").exists())
            self.assertEqual(info["file"], archive.name)
            self.assertEqual(info["size"], archive.stat().st_size)
            self.assertEqual(len(info["sha256"]), 64)
            with zipfile.ZipFile(archive) as z:
                self.assertEqual(z.read("host.cpp"), b"// corresponding source")
                self.assertIn("vendor.tar.gz", z.namelist())
            notice = (runtime / "SOURCE_CODE.txt").read_text()
            self.assertIn("https://cgplat.zqdesigned.city/downloads/" + archive.name, notice)


if __name__ == "__main__":
    unittest.main()
