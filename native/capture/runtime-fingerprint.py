"""Fingerprint native build inputs, independent of checkout line endings."""
import hashlib
import pathlib
import sys


def fingerprint(root):
    root = pathlib.Path(root)
    paths = [p for p in (root / "native/capture").rglob("*")
             if p.suffix in {".py", ".cpp", ".hpp", ".h", ".mm"}
             and "test" not in p.relative_to(root / "native/capture").parts]
    paths.append(root / "tools/windows-audio-build.ts")
    digest = hashlib.sha256()
    for p in sorted(paths, key=lambda p: p.relative_to(root).as_posix()):
        digest.update(p.relative_to(root).as_posix().encode() + b"\0")
        digest.update(p.read_bytes().replace(b"\r\n", b"\n") + b"\0")
    return digest.hexdigest()


if __name__ == "__main__":
    print(fingerprint(sys.argv[1] if len(sys.argv) > 1 else pathlib.Path(__file__).resolve().parents[2]))
