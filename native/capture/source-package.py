"""Keep corresponding source available without installing it as runtime data."""
import hashlib
import pathlib
import zipfile


def package_sources(source: pathlib.Path, runtime: pathlib.Path, archive: pathlib.Path):
    archive.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as z:
        for file in sorted(source.rglob("*")):
            if file.is_file():
                z.write(file, file.relative_to(source).as_posix(), compress_type=(
                    zipfile.ZIP_STORED if file.suffix in (".gz", ".zip") else zipfile.ZIP_DEFLATED
                ))
    info = {
        "file": archive.name,
        "size": archive.stat().st_size,
        "sha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
        "url": "https://cgplat.zqdesigned.city/downloads/" + archive.name,
    }
    (runtime / "SOURCE_CODE.txt").write_text(
        "CGScreenCaptureHost and modified OBS components: GPL-2.0-or-later.\n"
        "Exact corresponding source and build scripts are available separately at:\n"
        + info["url"] + "\nSHA256: " + info["sha256"] + "\n",
        encoding="utf-8",
    )
    return info
