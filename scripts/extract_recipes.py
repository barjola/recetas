#!/usr/bin/env python3
"""
Extractor resiliente de recetas de Monsieur Cuisine Connect / Smart.
Inspirado en la ingeniería inversa de MrCuisineVibeConnect (Toque).
Consume la API pública de Tecpal (https://mc-api.tecpal.com) con headers adecuados.

Características:
- Guarda y reutiliza recetas en la carpeta del repositorio (data/recipes.json).
- Actualización incremental: Solo descarga recetas nuevas o modificadas (lastUpdated).
- Resiliencia ante fallos: Si la API de Tecpal está caída o falla la red, utiliza las recetas
  ya guardadas en el repositorio y permite que el despliegue en GitHub Pages continúe con éxito.
"""

import argparse
import asyncio
import html
import json
import os
import re
import shutil
import sys
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

try:
    import aiohttp
except ImportError:
    aiohttp = None

BASE_API = "https://mc-api.tecpal.com"
PAGE_SIZE = 100
REPO_DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
SITE_DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "site", "data")


def clean_html(text: Optional[str]) -> str:
    """Convierte texto con posible HTML en texto plano limpio y ordenado."""
    if not text:
        return ""
    t = re.sub(r"(?i)<br\s*/?>|</p>|</li>|</div>", "\n", text)
    t = re.sub(r"<[^>]+>", "", t)
    t = html.unescape(t)
    t = t.replace("\xa0", " ")
    lines = [re.sub(r"[ \t]{2,}", " ", line).strip() for line in t.splitlines()]
    result = "\n".join(lines)
    result = re.sub(r"\n{3,}", "\n\n", result).strip()
    return result


def format_seconds(seconds: int) -> str:
    """Convierte segundos a formato legible como '5 min' o '30 s'."""
    if not seconds or seconds <= 0:
        return ""
    if seconds < 60:
        return f"{seconds} s"
    mins = seconds // 60
    rem_secs = seconds % 60
    if mins < 60:
        return f"{mins} min" if rem_secs == 0 else f"{mins} min {rem_secs} s"
    hours = mins // 60
    rem_mins = mins % 60
    return f"{hours} h" if rem_mins == 0 else f"{hours} h {rem_mins} min"


def format_mode(mode: str) -> str:
    """Traduce el modo del robot a texto legible en español."""
    m = (mode or "").lower().strip()
    mapping = {
        "customized": "Manual",
        "ramp": "Aceleración progresiva",
        "turbo": "Turbo",
        "steaming": "Vapor",
        "roasting": "Rehogar / Sofreír",
        "kneading": "Amasar",
        "knead": "Amasar",
        "scale": "Báscula",
    }
    return mapping.get(m, m.capitalize() if m else "Manual")


def normalize_ingredient_amount(amount: Any) -> str:
    if amount is None:
        return ""
    s = str(amount).strip()
    if s.endswith(".0"):
        s = s[:-2]
    return s


NON_PALEO_KEYWORDS = [
    'harina', 'trigo', 'arroz', 'pasta', 'espagueti', 'macarron', 'fideo', 'pan', 'pan rallado',
    'avena', 'maiz', 'maicena', 'cebada', 'centeno', 'espelta', 'cuscus', 'semola', 'quinoa',
    'hojaldre', 'masa brisa', 'masa quebrada', 'galleta', 'bizcocho', 'tostada',
    'flour', 'wheat', 'rice', 'pasta', 'spaghetti', 'noodle', 'bread', 'breadcrumb',
    'oat', 'corn', 'cornstarch', 'barley', 'rye', 'spelt', 'couscous', 'semolina',
    'lenteja', 'garbanzo', 'alubia', 'soja', 'tofu', 'edamame', 'cacahuete', 'mani',
    'lentil', 'chickpea', 'bean', 'soy', 'peanut',
    'queso', 'nata', 'mantequilla', 'yogur', 'parmesano', 'mozzarella', 'mascarpone',
    'ricotta', 'cuajada', 'crema de leche', 'crema agria',
    'cheese', 'cream', 'butter', 'yogurt', 'sour cream',
    'azucar', 'caramelo', 'fondant', 'edulcorante', 'sacarina',
    'sugar', 'caramel', 'sweetener',
    'avecrem', 'pastilla de caldo', 'detergente', 'bouillon', 'stock cube'
]


def is_paleo_recipe(title: str, categories: List[str], flat_ingredients: List[str]) -> bool:
    """Determina si una receta cumple las pautas de la Dieta Paleolítica."""
    t = (title or "").lower()
    if t.startswith("*") or "limpieza" in t or "cleaning" in t:
        return False
    cats = [c.lower() for c in categories]
    non_paleo_cats = [
        'panes y masas', 'pastas', 'postres y dulces', 'repostería', 'tartas y pasteles',
        'baking', 'desserts', 'pasta dishes'
    ]
    if any(c in non_paleo_cats for c in cats):
        return False
    if not flat_ingredients:
        return False
    for ing in flat_ingredients:
        i = ing.lower()
        if any(k in i for k in ['judia verde', 'judias verdes', 'green bean', 'string bean']):
            continue
        if any(k in i for k in ['leche de coco', 'leche de almendra', 'coconut milk', 'almond milk']):
            continue
        if any(k in i for k in ['harina de almendra', 'harina de coco', 'almond flour', 'coconut flour']):
            continue
        if 'harina' in i or 'flour' in i or 'leche' in i or 'milk' in i or 'judia' in i:
            return False
        for kw in NON_PALEO_KEYWORDS:
            if kw in i:
                return False
    return True


def parse_recipe_detail(raw: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Parsea el objeto completo retornado por /api/v2/recipes/{id}."""
    rec = raw.get("data", {}).get("recipe")
    if not rec:
        return None

    recipe_id = rec.get("id")
    title = (rec.get("name") or "").strip()
    if not recipe_id or not title:
        return None

    sizes = rec.get("servingSizes") or []
    default_size_id = rec.get("defaultServingSizeId")
    selected_size = next((s for s in sizes if s.get("id") == default_size_id), None)
    if not selected_size and sizes:
        selected_size = sizes[0]
    if not selected_size:
        selected_size = {}

    portions = selected_size.get("amount") or 4
    portion_unit = (selected_size.get("servingUnit") or "raciones").strip()

    categories = [
        c.get("name", "").strip()
        for c in rec.get("categories", [])
        if c.get("name", "").strip()
    ]
    raw_tags = rec.get("tags") or []
    tags = []
    for t in raw_tags:
        if isinstance(t, str) and t.strip():
            tags.append(t.strip())
        elif isinstance(t, dict) and t.get("name", "").strip():
            tags.append(t.get("name").strip())

    ingredient_groups = []
    raw_groups = selected_size.get("ingredientGroups") or []
    groups_map = {
        g.get("id"): (g.get("name") or "").strip()
        for g in sorted(raw_groups, key=lambda x: x.get("order", 0))
        if g.get("id") is not None
    }

    by_group: Dict[Optional[int], List[Dict[str, str]]] = {None: []}
    for gid in groups_map:
        by_group[gid] = []

    for ing in sorted(selected_size.get("ingredients") or [], key=lambda x: x.get("order", 0)):
        name = clean_html(ing.get("name"))
        if not name:
            continue
        gid = ing.get("ingredientGroupId")
        target_list = by_group.get(gid) if gid in groups_map else by_group[None]
        target_list.append({
            "qty": normalize_ingredient_amount(ing.get("amount")),
            "unit": (ing.get("unit") or "").strip(),
            "name": name,
            "note": clean_html(ing.get("description") or ""),
        })

    if by_group[None]:
        ingredient_groups.append({
            "title": "",
            "items": by_group[None]
        })
    for gid, gtitle in groups_map.items():
        if by_group.get(gid):
            ingredient_groups.append({
                "title": gtitle,
                "items": by_group[gid]
            })

    steps = []
    raw_steps = sorted(selected_size.get("steps") or [], key=lambda x: x.get("order", 0))
    for s in raw_steps:
        desc = clean_html(s.get("description") or s.get("name") or "")
        ds = s.get("deviceSetting") or {}
        settings_list = []

        if ds:
            mode = ds.get("mode") or ""
            reverse = bool(ds.get("reverse", False))
            raw_st = ds.get("settings") or [{}]
            for st in sorted(raw_st, key=lambda x: x.get("order", 0)):
                time_sec = st.get("time") or 0
                weight_g = st.get("weight") or 0
                temp = st.get("temperature") or 0
                speed = st.get("speed")
                if speed is None and st.get("speedFloat") is not None:
                    speed = int(st.get("speedFloat"))

                setting_obj = {
                    "mode": mode,
                    "mode_name": format_mode(mode),
                    "reverse": reverse,
                }
                if mode == "scale":
                    setting_obj["weight"] = weight_g
                else:
                    if time_sec > 0:
                        setting_obj["time_sec"] = time_sec
                        setting_obj["time_formatted"] = format_seconds(time_sec)
                    if temp > 0:
                        setting_obj["temperature"] = temp
                    if speed is not None and speed > 0:
                        setting_obj["speed"] = speed

                settings_list.append(setting_obj)

        steps.append({
            "step": len(steps) + 1,
            "text": desc,
            "settings": settings_list,
        })

    nutrients = []
    for nut in rec.get("nutrients") or []:
        n_name = nut.get("name")
        amount = nut.get("amount") or nut.get("amountFloat")
        unit = nut.get("unit") or ""
        if n_name and amount is not None:
            nutrients.append({
                "name": n_name,
                "amount": amount,
                "unit": unit
            })

    thumb = (
        rec.get("thumbnail", {}).get("landscape")
        or rec.get("detailsImage", {}).get("landscape")
        or rec.get("thumbnail", {}).get("square")
        or ""
    )

    flat_ingredients = [it["name"] for g in ingredient_groups for it in g.get("items", []) if it.get("name")]
    is_paleo = is_paleo_recipe(title, categories, flat_ingredients)

    return {
        "id": recipe_id,
        "title": title,
        "author": (rec.get("author", {}).get("name") or "Monsieur Cuisine").strip(),
        "rating": round(float(rec.get("rating") or 0.0), 2),
        "ratingCount": int(rec.get("totalRating") or 0),
        "prepTime": int(rec.get("preparationDuration") or 0),
        "totalTime": int(rec.get("duration") or 0),
        "difficulty": int(rec.get("complexityLevel") or 1),
        "portions": portions,
        "portionUnit": portion_unit,
        "categories": categories,
        "tags": list(dict.fromkeys(categories[1:] + tags)),
        "devices": rec.get("deviceTypes") or [],
        "image": thumb.strip(),
        "description": clean_html(rec.get("description")),
        "tips": clean_html(rec.get("hintsAndTips")),
        "ingredients": ingredient_groups,
        "steps": steps,
        "nutrients": nutrients,
        "is_paleo": is_paleo,
        "lastUpdated": rec.get("lastUpdated") or "",
        "url": rec.get("url") or f"https://www.monsieur-cuisine.com/recipe/{recipe_id}",
    }


def load_cached_recipes(cache_path: str) -> Dict[int, Dict[str, Any]]:
    """Carga recetas existentes de la caché persistente en disco."""
    recipes_map = {}
    if os.path.exists(cache_path):
        try:
            with open(cache_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                items = data if isinstance(data, list) else data.get("recipes", [])
                for r in items:
                    if r.get("id"):
                        recipes_map[r["id"]] = r
        except Exception as e:
            print(f"Aviso al leer caché {cache_path}: {e}")
    return recipes_map


def copy_cache_to_site(repo_recipes_path: str, repo_index_path: str, site_recipes_path: str, site_index_path: str):
    """Copia los archivos de caché del repositorio a la carpeta del sitio web."""
    os.makedirs(os.path.dirname(site_recipes_path), exist_ok=True)
    if os.path.exists(repo_recipes_path):
        shutil.copy2(repo_recipes_path, site_recipes_path)
    if os.path.exists(repo_index_path):
        shutil.copy2(repo_index_path, site_index_path)


async def fetch_recipe_list(
    session: aiohttp.ClientSession,
    lang: str,
    device: Optional[str],
    source: str,
    max_pages: Optional[int] = None
) -> List[Dict[str, Any]]:
    """Descarga el listado paginado con reintentos."""
    entries = []
    page = 1
    total_pages = 1

    while page <= total_pages:
        url = f"{BASE_API}/api/v2/recipes/page/{page}/size/{PAGE_SIZE}"
        params = []
        if device and device != "all":
            params.append(f"filters%5BdeviceTypes%5D%5B%5D={device}")
        if source:
            params.append(f"filters%5Bsource%5D%5B%5D={source}")
        if params:
            url += "?" + "&".join(params)

        success = False
        for attempt in range(3):
            try:
                async with session.get(url, timeout=aiohttp.ClientTimeout(total=20)) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        d = data.get("data", {})
                        total_pages = d.get("totalPage", 1)
                        total_items = d.get("total", 0)
                        recipes = d.get("recipes", [])
                        entries.extend(recipes)
                        print(f"[{page}/{total_pages}] Obtenidas {len(recipes)} recetas resumidas (Total catálogo: {total_items})")
                        success = True
                        break
                    else:
                        print(f"Aviso: Estado HTTP {resp.status} en página {page}, reintento ({attempt+1}/3)...")
                        await asyncio.sleep(1 + attempt)
            except Exception as e:
                print(f"Aviso: Excepción en página {page}: {e}, reintento ({attempt+1}/3)...")
                await asyncio.sleep(1 + attempt)

        if not success:
            raise RuntimeError(f"Fallo persistente al contactar con la API en página {page}")

        if max_pages and page >= max_pages:
            break
        page += 1

    return entries


async def fetch_single_detail(
    session: aiohttp.ClientSession,
    recipe_id: int,
    semaphore: asyncio.Semaphore
) -> Optional[Dict[str, Any]]:
    """Descarga y parsea una receta individual."""
    async with semaphore:
        url = f"{BASE_API}/api/v2/recipes/{recipe_id}"
        for attempt in range(3):
            try:
                async with session.get(url, timeout=aiohttp.ClientTimeout(total=20)) as resp:
                    if resp.status == 200:
                        raw = await resp.json()
                        return parse_recipe_detail(raw)
                    elif resp.status == 404:
                        return None
                    else:
                        await asyncio.sleep(0.5 * (attempt + 1))
            except Exception:
                await asyncio.sleep(0.5 * (attempt + 1))
        return None


async def main_async(args):
    start_time = time.time()

    # Rutas clave de persistencia y salida
    repo_file = os.path.join(REPO_DATA_DIR, "recipes.json")
    repo_index_file = os.path.join(REPO_DATA_DIR, "recipes_index.json")
    site_file = os.path.join(SITE_DATA_DIR, "recipes.json")
    site_index_file = os.path.join(SITE_DATA_DIR, "recipes_index.json")

    os.makedirs(REPO_DATA_DIR, exist_ok=True)
    os.makedirs(SITE_DATA_DIR, exist_ok=True)

    # 1. Cargar caché existente del repositorio
    existing_recipes = load_cached_recipes(repo_file)
    if not existing_recipes:
        existing_recipes = load_cached_recipes(site_file)

    cached_count = len(existing_recipes)
    print(f"📦 Recetas en repositorio (caché local): {cached_count}")

    headers = {
        "Accept": "application/json",
        "Accept-Language": args.lang,
        "device-type": "web",
        "User-Agent": "MrCuisineApp/2.0 (Web Client)",
    }

    connector = aiohttp.TCPConnector(limit=args.concurrency, ssl=True)
    final_recipes = []

    try:
        async with aiohttp.ClientSession(headers=headers, connector=connector) as session:
            print(f"🌐 Conectando con API oficial Monsieur Cuisine ({BASE_API})...")
            entries = await fetch_recipe_list(
                session=session,
                lang=args.lang,
                device=args.device,
                source=args.source
            )

            if not entries and cached_count > 0:
                print("⚠️ No se recibieron recetas del servidor pero tenemos caché. Usando datos guardados.")
                final_recipes = list(existing_recipes.values())
            else:
                if args.limit and args.limit > 0:
                    entries = entries[:args.limit]
                    print(f"Límite aplicado: procesando primeras {len(entries)} recetas.")

                # Determinar cuáles reutilizar y cuáles descargar
                to_fetch = []
                reused_count = 0

                for e in entries:
                    rid = e.get("id")
                    last_up = e.get("lastUpdated")
                    # Reutilizar si ya existe y no cambió la fecha de actualización
                    if rid in existing_recipes and existing_recipes[rid].get("lastUpdated") == last_up and not args.force:
                        final_recipes.append(existing_recipes[rid])
                        reused_count += 1
                    else:
                        to_fetch.append(rid)

                print(f"⚡ Estrategia incremental: {reused_count} recetas sin cambios reutilizadas | {len(to_fetch)} a descargar")

                if to_fetch:
                    semaphore = asyncio.Semaphore(args.concurrency)
                    tasks = [fetch_single_detail(session, rid, semaphore) for rid in to_fetch]
                    done_count = 0
                    for coro in asyncio.as_completed(tasks):
                        detail = await coro
                        done_count += 1
                        if detail:
                            final_recipes.append(detail)
                        if done_count % 50 == 0 or done_count == len(to_fetch):
                            print(f"Descargadas: {done_count}/{len(to_fetch)} recetas actualizadas...")

    except Exception as exc:
        print(f"\n⚠️ AVISO: Error o interrupción al contactar con la API externa: {exc}")
        if cached_count > 0:
            print(f"🛡️ ACTIVANDO MODO RESILIENTE: Se mantienen las {cached_count} recetas ya guardadas en el repositorio.")
            print("El despliegue continuará con éxito sin interrumpir el servicio.")
            copy_cache_to_site(repo_file, repo_index_file, site_file, site_index_file)
            print("✅ Datos del repositorio sincronizados para el despliegue.")
            return
        else:
            print("❌ Error crítico: Falló la API y no existen datos locales guardados.")
            sys.exit(1)

    if not final_recipes and cached_count > 0:
        final_recipes = list(existing_recipes.values())

    # Ordenar por título
    final_recipes.sort(key=lambda x: x.get("title", "").lower())

    # Metadatos globales y conteos
    categories_count = {}
    devices_count = {}
    for r in final_recipes:
        for cat in r.get("categories", []):
            categories_count[cat] = categories_count.get(cat, 0) + 1
        for dev in r.get("devices", []):
            devices_count[dev] = devices_count.get(dev, 0) + 1

    output_payload = {
        "metadata": {
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "totalRecipes": len(final_recipes),
            "language": args.lang,
            "device": args.device,
            "categories": sorted(categories_count.items(), key=lambda x: x[1], reverse=True),
            "devices": devices_count,
        },
        "recipes": final_recipes,
    }

    # Índice rápido
    index_recipes = [
        {
            "id": r["id"],
            "title": r["title"],
            "author": r["author"],
            "rating": r["rating"],
            "ratingCount": r["ratingCount"],
            "prepTime": r["prepTime"],
            "totalTime": r["totalTime"],
            "difficulty": r["difficulty"],
            "portions": r["portions"],
            "portionUnit": r["portionUnit"],
            "categories": r["categories"],
            "tags": r["tags"],
            "devices": r["devices"],
            "image": r["image"],
            "is_paleo": r.get("is_paleo", False),
            "ingredients": [it["name"] for g in r.get("ingredients", []) for it in g.get("items", []) if it.get("name")] if r.get("ingredients") and isinstance(r["ingredients"][0], dict) else r.get("ingredients", []),
        }
        for r in final_recipes
    ]
    index_payload = {
        "metadata": output_payload["metadata"],
        "recipes": index_recipes
    }

    # Guardar en data/ (Repositorio)
    with open(repo_file, "w", encoding="utf-8") as f:
        json.dump(output_payload, f, ensure_ascii=False, indent=2)

    with open(repo_index_file, "w", encoding="utf-8") as f:
        json.dump(index_payload, f, ensure_ascii=False)

    # Guardar en site/data/ (GitHub Pages)
    with open(site_file, "w", encoding="utf-8") as f:
        json.dump(output_payload, f, ensure_ascii=False, indent=2)

    with open(site_index_file, "w", encoding="utf-8") as f:
        json.dump(index_payload, f, ensure_ascii=False)

    repo_size_mb = os.path.getsize(repo_file) / (1024 * 1024)
    index_size_kb = os.path.getsize(repo_index_file) / 1024
    elapsed = round(time.time() - start_time, 2)

    print(f"\n🎉 Proceso completado con éxito en {elapsed}s:")
    print(f"  📁 Repositorio persistente: {repo_file} ({repo_size_mb:.2f} MB)")
    print(f"  📁 Repositorio índice:      {repo_index_file} ({index_size_kb:.1f} KB)")
    print(f"  🌐 Sitio web catálogo:      {site_file}")
    print(f"  🌐 Sitio web índice:        {site_index_file}")
    print(f"  📊 Total recetas activas:   {len(final_recipes)}")


def main():
    parser = argparse.ArgumentParser(description="Extractor resiliente de recetas Monsieur Cuisine")
    parser.add_argument("--lang", default="es-ES", help="Código de idioma (es-ES, fr-FR, de-DE, etc.)")
    parser.add_argument("--device", default="all", help="Dispositivo: all, MC2.0, MC3.0")
    parser.add_argument("--source", default="official", help="Fuente: official o todas")
    parser.add_argument("--limit", type=int, default=0, help="Límite para pruebas (0 = todas)")
    parser.add_argument("--concurrency", type=int, default=20, help="Peticiones concurrentes")
    parser.add_argument("--force", action="store_true", help="Forzar re-descarga de todas sin usar caché")

    args = parser.parse_args()

    if aiohttp is None:
        print("Error: Se requiere 'aiohttp'. Instálalo con 'pip install aiohttp'")
        sys.exit(1)

    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()
