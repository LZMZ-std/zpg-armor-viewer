"""Import clone equipment into the local viewer from Legion Studios PBOs."""

import argparse
import ast
import base64
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
import json
from pathlib import Path
import re
import struct
import subprocess
from tempfile import TemporaryDirectory

from PIL import Image


ROOT = Path(__file__).resolve().parent
PACKS = ("ls_core_characters_clone", "ls_core_characters_clone_legacy")
TABLE = struct.Struct("<5I")
TEXTURE_EXPORTER = """using System;
using System.IO;
using BIS.PAA.Conversion;
using var source = File.OpenRead(args[0]);
using var target = File.Create(args[1]);
PaaConverter.PaaToPng(source, target);
"""


@dataclass
class Member:
    pack: Path
    name: str
    offset: int
    length: int
    encoding: int

    def extract(self, path):
        if self.encoding:
            raise ValueError(f"Unsupported PBO encoding for {self.name}: {self.encoding:#x}")
        with self.pack.open("rb") as stream:
            stream.seek(self.offset)
            path.write_bytes(stream.read(self.length))


def read_pbo(path):
    with path.open("rb") as stream:
        def read_string():
            value = bytearray()
            while (char := stream.read(1)) != b"\0":
                if not char or len(value) > 8192:
                    raise ValueError(f"Invalid header: {path}")
                value.extend(char)
            return value.decode("utf-8", errors="replace")

        queue = []
        properties = {}
        while True:
            name = read_string().replace("\\", "/")
            method, _, _, _, size = TABLE.unpack(stream.read(TABLE.size))
            if name:
                queue.append((name, method, size))
            elif method == 0x56657273:
                while key := read_string():
                    properties[key.lower()] = read_string()
            else:
                break
        offset = stream.tell()
    prefix = normalize(properties.get("prefix", ""))
    members = []
    for name, method, size in queue:
        members.append(Member(path, name, offset, size, method))
        offset += size
    return prefix, members


def normalize(path):
    return path.replace("\\", "/").strip("/").lower()


def category(name):
    folder = normalize(name).split("/")[0]
    if folder == "equipment":
        return "nvgs"
    return {"helmets": "helmets", "uniforms": "bodies", "vests": "vests", "backpacks": "backpacks"}.get(folder)


def auxiliary(name):
    return any(word in Path(name).stem.lower() for word in ("hologram", "groundholder", "naked", "parachute"))


def choose_config(configs):
    def score(config):
        slots = config.get("hiddenSelections", [])
        maps = config.get("hiddenSelectionsTextures", [])
        return (sum(bool(ref) and not ref.startswith("#") for ref in maps[:len(slots)]),
                bool(config.get("displayName")))

    return max(configs, key=score, default={})


def write_asset(relative, data, mime=None):
    encoded = base64.b64encode(data).decode("ascii")
    if mime:
        encoded = f"data:{mime};base64,{encoded}"
    path = ROOT / (relative + ".asset.js")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("receiveArmorAsset(document.currentScript.dataset.assetId," + json.dumps(encoded) + ");\n",
                    encoding="ascii")
    return "./" + relative


def read_configs(args, packs, scratch):
    # Reuse the parser used to build the original catalog without running that build.
    names = {"classes", "merge_classes", "resolve"}
    tree = ast.parse(args.parser.read_text(encoding="utf-8-sig"))
    functions = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names]
    context = {"re": re}
    exec(compile(ast.Module(body=functions, type_ignores=[]), str(args.parser), "exec"), context)
    db = {}
    vehicles = {}
    for prefix, members in packs:
        config = next(member for member in members if normalize(member.name) in {"config.bin", "config.cpp"})
        raw = scratch / Path(config.name).name
        config.extract(raw)
        if raw.suffix.lower() == ".bin":
            decoded = scratch / "decoded.cpp"
            decoded.unlink(missing_ok=True)
            subprocess.run([str(args.arma_tools / "CfgConvert/CfgConvert.exe"), "-txt", "-dst", str(decoded),
                            str(raw)], check=True, capture_output=True)
        else:
            decoded = raw
        parsed = context["classes"](re.sub(r"//[^\n]*", "", decoded.read_text(encoding="utf-8-sig",
                                                                                 errors="replace")))
        for name, lookup in (("CfgWeapons", db), ("CfgVehicles", vehicles)):
            context["merge_classes"](lookup, parsed.get(name, {}).get("nested", {}))
    resolved = [context["resolve"](key, lookup) for lookup in (db, vehicles) for key in lookup]
    by_model = {}
    pairs = {}
    selected = {"camo1", "camo2", "camo3", "visor", "glass", "illum", "light"}
    for props in resolved:
        selected.update(props.get("hiddenSelections", []))
        model = normalize(props.get("uniformModel", props.get("model", "")))
        off = normalize(props.get("modelOff", ""))
        if off and off != model:
            pairs[model] = off
        if model:
            by_model.setdefault(model, []).append(props)
    return by_model, pairs, ",".join(sorted(selected))


def export_mesh(args, member, selections, scratch):
    filename = Path(member.name).name
    model_id = Path(filename).stem
    target = scratch / model_id
    target.mkdir(exist_ok=True)
    p3d = target / filename
    raw = target / "mesh.json"
    member.extract(p3d)
    result = subprocess.run(["dotnet", str(args.exporter), str(p3d), str(raw), selections],
                            capture_output=True, text=True, encoding="utf-8", errors="replace")
    if result.returncode:
        raise RuntimeError(result.stderr.splitlines()[0] if result.stderr else "Mesh conversion failed")
    model = json.loads(raw.read_text(encoding="utf-8"))
    groups = []
    binary = bytearray()
    for group in model["groups"]:
        texture, material = group["texture"], group["material"]
        if (not texture and not material) or texture.startswith("#") or not group["positions"]:
            continue
        entry = {"slot": Path(normalize(material)).stem, "selections": group["selections"],
                 "texture": texture, "count": len(group["positions"]) // 3}
        for attribute in ("positions", "normals", "uv", "arms"):
            data = group[attribute]
            entry[attribute] = {"offset": len(binary), "length": len(data)}
            binary.extend(struct.pack(f"<{len(data)}f", *data))
        groups.append(entry)
    if not groups:
        raise RuntimeError("No textured geometry in first visual LOD")
    return groups, binary


def import_models(args, scratch):
    catalog_file = ROOT / "content/armor-catalog.json"
    catalog = json.loads(catalog_file.read_text(encoding="utf-8-sig"))
    before = {key: len(catalog[key]) for key in ("helmets", "bodies", "vests", "backpacks", "nvgs")}
    known = {key.lower(): key for key, mesh in catalog["meshes"].items() if mesh["groups"]}
    imported = {item["model"].lower() for kind in before for item in catalog[kind] if item.get("pack") == "legion"}
    imported.update(item["offModel"].lower() for item in catalog["nvgs"] if item.get("pack") == "legion")
    texture_urls = {normalize(item["source"]): item["url"] for item in catalog["textures"]}
    indexed = {}
    packs = []
    for path in sorted((args.mod / "addons").glob("*.pbo")):
        prefix, members = read_pbo(path)
        indexed.update({f"{prefix}/{normalize(member.name)}": member for member in members})
        if path.stem in PACKS:
            packs.append((prefix, members))
    if len(packs) != len(PACKS):
        raise ValueError("Both clone model packs are required")
    props, pairs, selections = read_configs(args, packs, scratch)
    models = {}
    for prefix, members in packs:
        for member in members:
            path = f"{prefix}/{normalize(member.name)}"
            if member.name.lower().endswith(".p3d") and category(member.name) and not auxiliary(member.name):
                model = Path(member.name).stem.lower()
                if model not in known or (args.refresh and model in imported):
                    models[path] = member

    # Also pair models named _on/_off if there is no explicit config mapping.
    for path in models:
        if path.endswith("_on.p3d") and (off := path[:-7] + "_off.p3d") in indexed:
            pairs.setdefault(path, off)
    on_for_off = {off: on for on, off in pairs.items()}
    configs = {path: choose_config(props.get(path) or props.get(on_for_off.get(path), [])) for path in models}

    def convert(item):
        path, member = item
        try:
            return path, export_mesh(args, member, selections, scratch), None
        except (ValueError, RuntimeError) as error:
            return path, None, str(error)

    failures = []
    meshes = {}
    with ThreadPoolExecutor(max_workers=5) as pool:
        for path, result, error in pool.map(convert, models.items()):
            if error:
                failures.append((models[path].name, error))
            else:
                meshes[path] = result
    print(f"Converted {len(meshes)} models; {len(failures)} skipped by converter.", flush=True)
    for name, error in failures:
        print(f"  {name}: {error}", flush=True)

    references = {normalize(group["texture"]) for groups, _ in meshes.values() for group in groups}
    for path in meshes:
        references.update(normalize(ref) for ref in configs[path].get("hiddenSelectionsTextures", []))

    def convert_texture(ref):
        if not ref.endswith(".paa") or ref in texture_urls:
            return ref, None
        member = indexed.get(ref)
        if not member:
            return ref, None
        work = scratch / "textures" / ref
        work.parent.mkdir(parents=True, exist_ok=True)
        member.extract(work)
        png = work.with_suffix(".png")
        result = subprocess.run(["dotnet", "exec", "--runtimeconfig",
                                 str(args.exporter.with_suffix(".runtimeconfig.json")), "--depsfile",
                                 str(args.exporter.with_suffix(".deps.json")), str(texture_exporter), str(work), str(png)],
                                capture_output=True, cwd=texture_exporter.parent)
        if result.returncode or not png.exists():
            print(f"Texture fallback unavailable: {ref}", flush=True)
            return ref, None
        buffer = work.with_suffix(".webp")
        with Image.open(png) as image:
            image.thumbnail((1024, 1024))
            image.save(buffer, format="WEBP", quality=90, method=2)
        relative = "assets/armor/textures/" + str(Path(ref).with_suffix(".webp").as_posix())
        return ref, write_asset(relative, buffer.read_bytes(), "image/webp")

    texture_exporter = compile_texture_exporter(args.exporter.parent, scratch)
    with ThreadPoolExecutor(max_workers=5) as pool:
        for ref, url in pool.map(convert_texture, sorted(references)):
            if url:
                texture_urls[ref] = url
                catalog["textures"].append({"source": ref, "url": url})

    for path, (groups, binary) in meshes.items():
        model_id = Path(models[path].name).stem
        config = configs[path]
        overrides = {
            name.lower(): texture_urls.get(normalize(ref))
            for name, ref in zip(config.get("hiddenSelections", []), config.get("hiddenSelectionsTextures", []))
        }
        for group in groups:
            names = [name.lower() for name in group["selections"]]
            slot = group["slot"].lower()
            # Prefer the named visor/glass override only on the matching material.
            if slot in overrides:
                names = [slot, *names]
            group["defaultMap"] = next((overrides[name] for name in names if overrides.get(name)),
                                       texture_urls.get(normalize(group["texture"])))
        catalog["meshes"][model_id] = {
            "url": write_asset(f"assets/armor/models/{model_id}.bin", binary), "groups": groups
        }
        known[model_id.lower()] = model_id

    paired_off = {off for on, off in pairs.items() if on in meshes}
    for path in meshes:
        if path in paired_off:
            continue
        member = models[path]
        kind = category(member.name)
        model_id = Path(member.name).stem
        if any(item["id"] == model_id for item in catalog[kind]):
            continue
        configs = props.get(path, [])
        config = next((entry for entry in configs if entry.get("displayName") and
                       not entry["displayName"].startswith("$")), configs[0] if configs else {})
        label = config.get("displayName", "")
        if not label or label.startswith("$"):
            label = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", re.sub(r"^lsd?_(gar_|sob_)?", "", model_id))
            label = label.replace("_", " ").title()
        entry = {"id": model_id, "name": label + " · Legion", "pack": "legion", "model": model_id}
        if kind == "nvgs":
            entry["offModel"] = known.get(Path(pairs.get(path, "")).stem.lower(), model_id)
        if kind == "bodies":
            entry.update({"upper": None, "lower": None})
        else:
            entry.update({"maps": [], "slots": []})
        entry["useMeshMaterials"] = True
        catalog[kind].append(entry)
    catalog_file.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    for kind, count in before.items():
        print(f"{kind}: +{len(catalog[kind]) - count}")


def compile_texture_exporter(libraries, scratch):
    import shutil

    sdk_rows = subprocess.check_output(["dotnet", "--list-sdks"], text=True).splitlines()
    version, sdk = next(row.split(" [", 1) for row in reversed(sdk_rows) if row.startswith("8."))
    sdk_root = Path(sdk.rstrip("]"))
    compiler = sdk_root / version / "Roslyn/bincore/csc.dll"
    references = sdk_root.parent / "packs/Microsoft.NETCore.App.Ref"
    framework = next(path / "ref/net8.0" for path in references.iterdir() if path.name.startswith("8.")
                     and (path / "ref/net8.0").is_dir())
    directory = scratch / "paa-converter"
    directory.mkdir()
    for library in libraries.glob("*.dll"):
        shutil.copyfile(library, directory / library.name)
    source = directory / "Convert.cs"
    source.write_text(TEXTURE_EXPORTER, encoding="utf-8")
    output = directory / "ArmorPaaExport.dll"
    subprocess.run(["dotnet", str(compiler), "-nologo", "-out:" + str(output),
                    *("-r:" + str(ref) for ref in framework.glob("*.dll")),
                    "-r:" + str(directory / "BIS.PAA.dll"), str(source)], check=True)
    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ("mod", "exporter", "parser", "arma-tools"):
        parser.add_argument("--" + key, type=Path, required=True)
    parser.add_argument("--refresh", action="store_true", help="Refresh previously imported Legion materials")
    arguments = parser.parse_args()
    with TemporaryDirectory(prefix=".armor-import-", dir=ROOT) as directory:
        import_models(arguments, Path(directory))
