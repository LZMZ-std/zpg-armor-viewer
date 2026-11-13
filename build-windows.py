"""Bundle the local viewer and its assets into one Windows executable."""

import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from zipfile import ZIP_DEFLATED, ZipFile


ROOT = Path(__file__).resolve().parent


def catalog_assets(value):
    if isinstance(value, dict):
        for item in value.values():
            yield from catalog_assets(item)
    elif isinstance(value, list):
        for item in value:
            yield from catalog_assets(item)
    elif isinstance(value, str) and value.startswith("./assets/"):
        yield value[2:] + ".asset.js"


def windows_paths(files):
    unique = {}
    for name in sorted(files):
        key = name.casefold()
        previous = unique.setdefault(key, name)
        if previous != name and not (ROOT / previous).samefile(ROOT / name):
            if (ROOT / previous).read_bytes() != (ROOT / name).read_bytes():
                raise ValueError(f"Conflicting Windows paths: {previous} and {name}")
    return unique.values()


def build(esbuild):
    env = {**os.environ, "ARMOR_ESBUILD": str(esbuild)}
    subprocess.run([
        "node", "-e",
        "require(process.env.ARMOR_ESBUILD).buildSync({"
        "entryPoints:['armor.js'],bundle:true,format:'iife',outfile:'armor-app.js'})",
    ], cwd=ROOT, env=env, check=True)

    catalog = json.loads((ROOT / "content/armor-catalog.json").read_text(encoding="utf-8-sig"))
    files = {"index.html", "armor.css", "armor-app.js", "zpg-icon.ico", "assets/vendor/three/LICENSE"}
    files.update(catalog_assets(catalog))
    files = windows_paths(files)
    compiler = Path(os.environ["WINDIR"]) / "Microsoft.NET/Framework64/v4.0.30319/csc.exe"

    with tempfile.TemporaryDirectory(prefix=".armor-build-", dir=ROOT) as temporary:
        directory = Path(temporary)
        payload = directory / "viewer.zip"
        with ZipFile(payload, "w", ZIP_DEFLATED, compresslevel=4) as archive:
            for name in files:
                archive.write(ROOT / name, name)
        with payload.open("rb") as stream:
            version = hashlib.file_digest(stream, "sha256").hexdigest()[:24]
        executable = directory / "ArmorViewer.exe"
        subprocess.run([
            str(compiler), "/nologo", "/target:winexe", "/platform:anycpu", "/optimize+",
            "/win32icon:" + str(ROOT / "zpg-icon.ico"),
            "/codepage:65001", "/reference:System.Windows.Forms.dll",
            "/reference:System.IO.Compression.dll", "/reference:System.IO.Compression.FileSystem.dll",
            "/out:" + str(executable), "/resource:" + str(payload) + ",ArmorViewer.Payload." + version,
            str(ROOT / "ArmorViewerLauncher.cs"),
        ], check=True)
        os.replace(executable, ROOT / executable.name)
        print(f"Packed {len(files)} files. Payload version: {version}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("Usage: python build-windows.py <path to esbuild package>")
    build(Path(sys.argv[1]).resolve())
