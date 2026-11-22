"""Meteo Nord Italia - server locale.

Aggrega le osservazioni in tempo reale delle reti di stazioni del Nord Italia
e delle zone di confine e le serve, insieme a una griglia previsionale
(Open-Meteo), alla mappa in ./web.  Solo libreria standard di Python.

Avvio:  python server.py   ->   http://localhost:8765
"""
import csv
import gzip
import hashlib
import hmac
import io
import json
import math
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(ROOT, "web")
CACHE_DIR = os.path.join(ROOT, "cache")
PORT = int(os.environ.get("METEO_PORT", "8765"))

# Area coperta dalle stazioni (lon min, lat min, lon max, lat max)
BBOX = (5.4, 43.2, 15.6, 48.1)
# Griglia previsionale
GRID = dict(lon0=6.0, lon1=14.5, lat0=43.5, lat1=47.75, step=0.25)
GRID_VARS = [
    "temperature_2m", "relative_humidity_2m", "precipitation", "cloud_cover",
    "cloud_cover_low", "cloud_cover_mid", "cloud_cover_high", "wind_speed_10m",
    "wind_direction_10m", "wind_gusts_10m", "pressure_msl",
]
GRID_TTL = 3 * 3600
STATIONS_TTL = 10 * 60
MAX_AGE_H = 6  # scarta osservazioni piu' vecchie

UA = "MeteoNordItalia/1.0 (app personale locale)"
UTC = timezone.utc
CET = timezone(timedelta(hours=1))  # ora solare, usata dalle ARPA


def http_get(url, timeout=40):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "gzip"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = r.read()
        if r.headers.get("Content-Encoding") == "gzip":
            data = gzip.decompress(data)
        return data


def get_json(url, timeout=40):
    return json.loads(http_get(url, timeout).decode("utf-8"))


def num(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if math.isnan(f) or f <= -900:
        return None
    return f


def iso(dt):
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%MZ")


def in_bbox(lat, lon):
    return lat is not None and lon is not None and BBOX[0] <= lon <= BBOX[2] and BBOX[1] <= lat <= BBOX[3]


def kmh(ms):
    return None if ms is None else ms * 3.6


def station(src, sid, name, lat, lon, alt=None):
    return {"id": f"{src}:{sid}", "src": src, "name": name, "lat": lat, "lon": lon,
            "alt": alt, "time": None}


# ----------------------------------------------------------------- sorgenti
def src_meteoswiss():
    meta = {}
    txt = http_get("https://data.geo.admin.ch/ch.meteoschweiz.messnetz-automatisch/"
                   "ch.meteoschweiz.messnetz-automatisch_en.csv").decode("latin-1")
    for row in csv.DictReader(io.StringIO(txt), delimiter=";"):
        ab = row.get("Abbr.")
        if ab:
            meta[ab] = row
    txt = http_get("https://data.geo.admin.ch/ch.meteoschweiz.messwerte-aktuell/VQHA80.csv").decode("latin-1")
    out = []
    for row in csv.DictReader(io.StringIO(txt), delimiter=";"):
        m = meta.get(row.get("Station/Location"))
        if not m:
            continue
        lat, lon = num(m["Latitude"]), num(m["Longitude"])
        if not in_bbox(lat, lon):
            continue
        s = station("ch", row["Station/Location"], m["Station"], lat, lon,
                    num(m["Station height m a. sea level"]))
        try:
            s["time"] = iso(datetime.strptime(row["Date"], "%Y%m%d%H%M").replace(tzinfo=UTC))
        except ValueError:
            continue
        s.update(t=num(row.get("tre200s0")), pr=num(row.get("rre150z0")), prm=10,
                 sun=num(row.get("sre000z0")), rad=num(row.get("gre000z0")),
                 rh=num(row.get("ure200s0")), td=num(row.get("tde200s0")),
                 wd=num(row.get("dkl010z0")), ws=num(row.get("fu3010z0")),
                 wg=num(row.get("fu3010z1")),
                 p=num(row.get("pp0qffs0")) or num(row.get("pp0qnhs0")),
                 pst=num(row.get("prestas0")))
        out.append(s)
    return out


def src_geosphere():
    base = "https://dataset.api.hub.geosphere.at/v1/station/current/tawes-v1-10min"
    meta = get_json(base + "/metadata")
    st = {str(x["id"]): x for x in meta["stations"]
          if x.get("is_active", True) and in_bbox(x.get("lat"), x.get("lon"))}
    out = []
    ids = list(st)
    params = "TL,RF,TP,PRED,P,FF,FFX,DD,RR,SO,GLOW,SCHNEE"
    for i in range(0, len(ids), 120):
        d = get_json(f"{base}?parameters={params}&station_ids={','.join(ids[i:i+120])}&output_format=geojson")
        ts = datetime.fromisoformat(d["timestamps"][0])
        for f in d["features"]:
            sid = str(f["properties"]["station"])
            m = st.get(sid)
            if not m:
                continue
            p = {k: (v["data"][0] if v.get("data") else None) for k, v in f["properties"]["parameters"].items()}
            s = station("at", sid, m["name"].title(), m["lat"], m["lon"], m.get("altitude"))
            s["time"] = iso(ts)
            sun = num(p.get("SO"))
            s.update(t=num(p.get("TL")), rh=num(p.get("RF")), td=num(p.get("TP")),
                     p=num(p.get("PRED")), pst=num(p.get("P")), ws=kmh(num(p.get("FF"))),
                     wg=kmh(num(p.get("FFX"))), wd=num(p.get("DD")), pr=num(p.get("RR")), prm=10,
                     sun=None if sun is None else sun / 60, rad=num(p.get("GLOW")),
                     snow=num(p.get("SCHNEE")))
            out.append(s)
    return out


def src_arso():
    root = ET.fromstring(http_get("https://meteo.arso.gov.si/uploads/probase/www/observ/surface/"
                                  "text/sl/observationAms_si_latest.xml"))
    out = []
    for m in root.iter("metData"):
        g = lambda k: (m.findtext(k) or "").strip()
        lat, lon = num(g("domain_lat")), num(g("domain_lon"))
        if not in_bbox(lat, lon):
            continue
        s = station("si", g("domain_meteosiId"), g("domain_longTitle") or g("domain_title"),
                    lat, lon, num(g("domain_altitude")))
        try:
            s["time"] = iso(datetime.strptime(g("tsValid_issued_UTC"), "%d.%m.%Y %H:%M UTC").replace(tzinfo=UTC))
        except ValueError:
            continue
        s.update(t=num(g("t")), td=num(g("td")), rh=num(g("rh")), wd=num(g("dd_val")),
                 ws=kmh(num(g("ff_val"))), wg=kmh(num(g("ffmax_val"))), p=num(g("msl")),
                 pst=num(g("p")), pr=num(g("rr_val")), prm=10 if g("rr_val") else None,
                 rad=num(g("gSunRad")), snow=num(g("snow")), vis=num(g("vis_val")))
        out.append(s)
    return out


def src_lombardia():
    base = "https://www.dati.lombardia.it/resource/"
    sensors = get_json(base + "nf78-nj6b.json?$limit=20000&$where=" + urllib.parse.quote("storico='N'"))
    kind = {"Temperatura": "t", "Umidità Relativa": "rh", "Precipitazione": "pr",
            "Velocità Vento": "ws", "Direzione Vento": "wd", "Radiazione Globale": "rad",
            "Altezza Neve": "snow"}
    smap = {}
    for x in sensors:
        k = kind.get(x.get("tipologia"))
        if k:
            smap[x["idsensore"]] = (k, x)
    last = get_json(base + "647i-nhxk.json?$select=max(data)")[0]["max_data"]
    since = (datetime.fromisoformat(last) - timedelta(minutes=70)).strftime("%Y-%m-%dT%H:%M:%S")
    rows = get_json(base + "647i-nhxk.json?$limit=60000&$where=" +
                    urllib.parse.quote(f"data > '{since}' AND stato = 'VA'"), timeout=90)
    best = {}
    for r in rows:
        sid = r["idsensore"]
        if sid in smap and (sid not in best or r["data"] > best[sid]["data"]):
            best[sid] = r
    sts = {}
    for sid, r in best.items():
        k, x = smap[sid]
        v = num(r.get("valore"))
        lat, lon = num(x.get("lat")), num(x.get("lng"))
        if v is None or not in_bbox(lat, lon):
            continue
        s = sts.get(x["idstazione"])
        if not s:
            s = sts[x["idstazione"]] = station("lom", x["idstazione"], x["nomestazione"], lat, lon,
                                               num(x.get("quota")))
        t = iso(datetime.fromisoformat(r["data"]).replace(tzinfo=CET))
        if not s["time"] or t > s["time"]:
            s["time"] = t
        if k == "ws":
            v = kmh(v)
        if k == "pr":
            s["prm"] = 10
        s[k] = v
    return list(sts.values())


def src_veneto():
    codes = {18: "t", 19: "rh", 20: "pst", 12: "ws", 13: "wd", 22: "rad", 23: "pr"}
    sts = {}

    def one(code):
        return code, get_json(f"https://api.arpa.veneto.it/REST/v1/meteo_meteogrammi?rete=MGRAMMI&coordcd={code}&orario=0")

    with ThreadPoolExecutor(4) as ex:
        for code, d in ex.map(one, codes):
            k = codes[code]
            for r in d.get("data", []):
                v = num(r.get("valore"))
                lat, lon = num(r.get("latitudine")), num(r.get("longitudine"))
                if v is None or not in_bbox(lat, lon):
                    continue
                sid = r["codseqst"]
                s = sts.get(sid)
                if not s:
                    s = sts[sid] = station("ven", sid, r["nome_stazione"], lat, lon, num(r.get("quota")))
                t = iso(datetime.fromisoformat(r["dataora"]).replace(tzinfo=CET))
                if not s["time"] or t > s["time"]:
                    s["time"] = t
                if k == "ws":
                    v = kmh(v)
                if k == "pr":
                    s["prm"] = 60
                s[k] = v
    return list(sts.values())


def src_liguria():
    kinds = {"Termo": "t", "Igro": "rh", "Pluvio": "pr", "Vento": "ws", "Press": "p",
             "Neve": "snow", "Radio": "rad"}
    sts = {}

    def one(kind):
        return kind, get_json(f"https://omirl.regione.liguria.it/Omirl/rest/stations/{kind}")

    with ThreadPoolExecutor(4) as ex:
        for kind, rows in ex.map(one, kinds):
            k = kinds[kind]
            for r in rows:
                v = num(r.get("value"))
                lat, lon = num(r.get("lat")), num(r.get("lon"))
                if v is None or not in_bbox(lat, lon) or not r.get("refDate"):
                    continue
                sid = r["shortCode"]
                s = sts.get(sid)
                if not s:
                    s = sts[sid] = station("lig", sid, r["name"], lat, lon, num(r.get("alt")))
                t = iso(datetime.fromisoformat(r["refDate"]).replace(tzinfo=UTC))
                if not s["time"] or t > s["time"]:
                    s["time"] = t
                s[k] = v
                if k == "ws":
                    s["wd"] = num(r.get("increment"))
    return list(sts.values())


def src_emilia():
    raw = http_get("https://dati-simc.arpae.it/opendata/osservati/meteo/realtime/realtime.jsonl", timeout=120)
    sts, when = {}, {}
    for line in raw.splitlines():
        if not line.strip():
            continue
        try:
            rec = json.loads(line)
        except ValueError:
            continue
        date = rec.get("date")
        key = (rec.get("network"), rec.get("lon"), rec.get("lat"))
        if not date or key[1] is None:
            continue
        head = rec["data"][0]["vars"]
        lat, lon = rec["lat"] / 1e5, rec["lon"] / 1e5
        if not in_bbox(lat, lon):
            continue
        s = sts.get(key)
        if not s:
            name = (head.get("B01019") or {}).get("v") or "Stazione"
            s = sts[key] = station("emr", f"{key[0]}_{key[1]}_{key[2]}", name, lat, lon,
                                   num((head.get("B07030") or {}).get("v")))
            when[key] = {}
        w = when[key]

        def put(k, v, prio=0):
            if v is None:
                return
            old = w.get(k)
            if old is None or (date, prio) >= old:
                w[k] = (date, prio)
                s[k] = v

        for blk in rec["data"][1:]:
            tr = blk.get("timerange") or [None, None, None]
            vs = blk.get("vars", {})
            g = lambda c: num((vs.get(c) or {}).get("v"))
            inst = tr[0] == 254
            if inst or (tr[0] == 0 and tr[2] in (900, 3600)):
                pr = 2 if inst else 1
                if g("B12101") is not None:
                    put("t", g("B12101") - 273.15, pr)
                put("rh", g("B13003"), pr)
                put("wd", g("B11001"), pr)
                put("ws", kmh(g("B11002")), pr)
                if g("B10004") is not None:
                    put("pst", g("B10004") / 100, pr)
                if g("B13013") is not None:
                    put("snow", g("B13013") * 100, pr)
                put("rad", g("B14198"), pr)
            if tr[0] == 1 and tr[2] == 3600 and g("B13011") is not None:
                put("pr", g("B13011"), 1)
                s["prm"] = 60
            if tr[0] == 2 and g("B11041") is not None:
                put("wg", kmh(g("B11041")), 1)
    out = []
    for key, s in sts.items():
        dates = [d for d, _ in when[key].values()]
        if not dates or "t" not in s and "pr" not in s:
            continue
        s["time"] = iso(datetime.fromisoformat(max(dates).replace("Z", "+00:00")))
        out.append(s)
    return out


def src_trentino():
    ns = "{http://www.meteotrentino.it/}"
    root = ET.fromstring(http_get("https://dati.meteotrentino.it/service.asmx/getListOfMeteoStations"))
    lst = []
    for p in root.iter(ns + "pointOfMeasureInfo"):
        if (p.findtext(ns + "enddate") or "").strip():
            continue
        lat, lon = num(p.findtext(ns + "latitude")), num(p.findtext(ns + "longitude"))
        if in_bbox(lat, lon):
            lst.append((p.findtext(ns + "code"), p.findtext(ns + "name"), lat, lon,
                        num(p.findtext(ns + "elevation"))))

    def last(root, tag):
        els = root.findall(f".//{ns}{tag}")
        return els[-1] if els else None

    def one(item):
        code, name, lat, lon, alt = item
        try:
            r = ET.fromstring(http_get(
                f"https://dati.meteotrentino.it/service.asmx/getLastDataOfMeteoStation?codice={code}", 25))
        except Exception:
            return None
        s = station("tn", code, name, lat, lon, alt)
        times = []

        def val(tag, child="value"):
            el = last(r, tag)
            if el is None:
                return None
            d = el.findtext(ns + "date")
            if d:
                times.append(d)
            return num(el.findtext(ns + child))

        s["t"] = val("air_temperature")
        s["pr"] = val("precipitation")
        s["prm"] = 15 if s["pr"] is not None else None
        s["rh"] = val("relative_humidity")
        s["rad"] = val("global_radiation")
        s["ws"] = kmh(val("wind10m", "speed_value"))
        s["wg"] = kmh(val("wind10m", "windgust"))
        s["wd"] = val("wind10m", "direction_value")
        if not times:
            return None
        d = max(times)
        if re.search(r"[+-]\d\d$", d):
            d += ":00"
        s["time"] = iso(datetime.fromisoformat(d))
        return s

    with ThreadPoolExecutor(10) as ex:
        return [s for s in ex.map(one, lst) if s]


def src_altoadige():
    url = ("https://mobility.api.opendatahub.com/v2/flat/MeteoStation/*/latest?limit=-1"
           "&where=sorigin.eq.SIAG,sactive.eq.true"
           "&select=scode,sname,scoordinate,tname,mvalue,mvalidtime,mperiod,smetadata.elevation")
    kind = {"air-temperature": "t", "air-humidity": "rh", "wind-speed": "ws", "wind-direction": "wd",
            "wind-gust-speed": "wg", "precipitation": "pr", "global-radiation": "rad",
            "atmospheric-pressure-reduced": "p", "snow-level": "snow", "sunshine-duration": "sun"}
    sts = {}
    fresh = iso(datetime.now(UTC) - timedelta(hours=3))
    for r in get_json(url, timeout=90).get("data", []):
        k = kind.get(r.get("tname"))
        c = r.get("scoordinate") or {}
        v = num(r.get("mvalue"))
        lat, lon = num(c.get("y")), num(c.get("x"))
        if not k or v is None or not in_bbox(lat, lon) or not r.get("mvalidtime"):
            continue
        t = iso(datetime.strptime(r["mvalidtime"][:19], "%Y-%m-%d %H:%M:%S").replace(tzinfo=UTC))
        if t < fresh or (k == "pr" and r.get("mperiod") not in (300, 600)):
            continue
        s = sts.get(r["scode"])
        if not s:
            s = sts[r["scode"]] = station("bz", r["scode"], r["sname"], lat, lon,
                                          num(r.get("smetadata.elevation")))
        if not s["time"] or t > s["time"]:
            s["time"] = t
        if k in ("ws", "wg"):
            v = kmh(v)
        if k == "pr":
            s["prm"] = round((num(r.get("mperiod")) or 300) / 60)
        if k == "sun":
            v = v / 60
        s[k] = v
    return list(sts.values())


CLOUD_PCT = {"SKC": 0, "CLR": 0, "NSC": 0, "NCD": 0, "CAVOK": 0, "FEW": 19, "SCT": 44, "BKN": 75,
             "OVC": 100, "OVX": 100, "VV": 100}


def src_metar():
    rows = get_json(f"https://aviationweather.gov/api/data/metar?bbox={BBOX[1]},{BBOX[0]},{BBOX[3]},{BBOX[2]}&format=json")
    best = {}
    for r in rows:
        if r.get("icaoId") and (r["icaoId"] not in best or r.get("obsTime", 0) > best[r["icaoId"]].get("obsTime", 0)):
            best[r["icaoId"]] = r
    out = []
    for r in best.values():
        lat, lon = num(r.get("lat")), num(r.get("lon"))
        if not in_bbox(lat, lon) or not r.get("obsTime"):
            continue
        name = (r.get("name") or r["icaoId"]).split(",")[0].replace(" Arpt", "").replace("/", " · ")
        s = station("metar", r["icaoId"], f"{name} ({r['icaoId']})", lat, lon, num(r.get("elev")))
        s["time"] = iso(datetime.fromtimestamp(r["obsTime"], UTC))
        layers = [CLOUD_PCT.get(c.get("cover")) for c in (r.get("clouds") or [])]
        layers = [c for c in layers if c is not None]
        cloud = max(layers) if layers else CLOUD_PCT.get(r.get("cover"))
        base = [num(c.get("base")) for c in (r.get("clouds") or []) if num(c.get("base")) is not None]
        vis = r.get("visib")
        vis = 6.22 if isinstance(vis, str) and "+" in vis else num(vis)
        wd = num(r.get("wdir"))
        kt = lambda v: None if num(v) is None else num(v) * 1.852
        s.update(t=num(r.get("temp")), td=num(r.get("dewp")), wd=wd, ws=kt(r.get("wspd")),
                 wg=kt(r.get("wgst")), p=num(r.get("altim")), cloud=cloud,
                 cbase=round(min(base) * 0.3048) if base else None,
                 vis=None if vis is None else round(vis * 1.609, 1), raw=r.get("rawOb"))
        out.append(s)
    return out


def utc_from_isoz(txt):
    return datetime.fromisoformat(txt.replace("Z", "+00:00")).astimezone(UTC)


def eu_local_to_utc(dt):
    """Ora locale dell'Europa centrale (con ora legale) -> UTC."""
    y = dt.year
    last_sun = lambda m: max(d for d in range(25, 32) if datetime(y, m, d).weekday() == 6)
    start = datetime(y, 3, last_sun(3), 2)
    end = datetime(y, 10, last_sun(10), 3)
    off = 2 if start <= dt < end else 1
    return (dt - timedelta(hours=off)).replace(tzinfo=UTC)


def src_slf():
    """SLF: stazioni IMIS delle Alpi svizzere (neve, vento e temperatura in quota)."""
    base = "https://measurement-api.slf.ch/public/api/imis/"
    meta = {x["code"]: x for x in get_json(base + "stations")}
    last = {}
    for r in get_json(base + "measurements", timeout=90):
        c = r.get("station_code")
        if c in meta and r.get("measure_date") and (c not in last or r["measure_date"] > last[c]["measure_date"]):
            last[c] = r
    out = []
    for c, r in last.items():
        m = meta[c]
        lat, lon = num(m.get("lat")), num(m.get("lon"))
        if not in_bbox(lat, lon):
            continue
        s = station("slf", c, m.get("label") or c, lat, lon, num(m.get("elevation")))
        s["time"] = iso(utc_from_isoz(r["measure_date"]))
        s.update(t=num(r.get("TA_30MIN_MEAN")), rh=num(r.get("RH_30MIN_MEAN")),
                 ws=kmh(num(r.get("VW_30MIN_MEAN"))), wg=kmh(num(r.get("VW_30MIN_MAX"))),
                 wd=num(r.get("DW_30MIN_MEAN")), snow=num(r.get("HS")))
        out.append(s)
    return out


def src_tirol():
    """Servizio valanghe del Tirolo (avalanche.report): stazioni di montagna del Tirolo austriaco."""
    d = get_json("https://static.avalanche.report/weather_stations/stations.geojson")
    out = []
    for f in d.get("features", []):
        p = f.get("properties") or {}
        if not str(p.get("LWD-Region") or "").startswith("AT-07") or not p.get("date"):
            continue  # Alto Adige e Trentino arrivano gia' dalle loro reti ufficiali
        c = (f.get("geometry") or {}).get("coordinates") or []
        if len(c) < 2:
            continue
        lon, lat = num(c[0]), num(c[1])
        if not in_bbox(lat, lon):
            continue
        sid = p.get("LWD-Nummer") or p.get("plot") or f.get("id")
        s = station("tir", sid, p.get("name") or sid, lat, lon, num(c[2]) if len(c) > 2 else None)
        s["time"] = iso(datetime.fromisoformat(p["date"]))
        s.update(t=num(p.get("LT")), rh=num(p.get("RH")), td=num(p.get("TD")), ws=num(p.get("WG")),
                 wg=num(p.get("WG_BOE")), wd=num(p.get("WR")), pst=num(p.get("LD")),
                 snow=num(p.get("HS")), rad=num(p.get("GS_O")))
        out.append(s)
    return out


HR_DIR = {"N": 0, "NE": 45, "E": 90, "SE": 135, "S": 180, "SW": 225, "W": 270, "NW": 315,
          "NNE": 22, "ENE": 67, "ESE": 112, "SSE": 157, "SSW": 202, "WSW": 247, "WNW": 292, "NNW": 337}


def src_croazia():
    """DHMZ: osservazioni orarie delle stazioni croate (Istria, Quarnero, Lika)."""
    root = ET.fromstring(http_get("https://vrijeme.hr/hrvatska_n.xml"))
    dt = eu_local_to_utc(datetime.strptime(root.findtext("DatumTermin/Datum").strip() + " "
                                           + root.findtext("DatumTermin/Termin").strip(), "%d.%m.%Y %H"))
    out = []
    for g in root.iter("Grad"):
        lat, lon = num((g.findtext("Lat") or "").strip()), num((g.findtext("Lon") or "").strip())
        if not in_bbox(lat, lon):
            continue
        d = lambda k: (g.findtext("Podatci/" + k) or "").strip()
        s = station("hr", g.findtext("GradIme").strip(), g.findtext("GradIme").strip(), lat, lon)
        s["time"] = iso(dt)
        ws = num(d("VjetarBrzina"))
        s.update(t=num(d("Temp")), rh=num(d("Vlaga")), p=num(d("Tlak")), ws=kmh(ws),
                 wd=HR_DIR.get(d("VjetarSmjer").upper()))
        out.append(s)
    return out


def src_vento():
    """OpenWindMap (Pioupiou): anemometri dei volatori, utili per il vento in montagna."""
    d = get_json("https://api.pioupiou.fr/v1/live/all")
    fresh = datetime.now(UTC) - timedelta(hours=2)
    out = []
    for x in d.get("data", []):
        loc, m = x.get("location") or {}, x.get("measurements") or {}
        lat, lon = num(loc.get("latitude")), num(loc.get("longitude"))
        if (x.get("status") or {}).get("state") != "on" or not in_bbox(lat, lon) or not m.get("date"):
            continue
        t = utc_from_isoz(m["date"])
        if t < fresh:
            continue
        name = ((x.get("meta") or {}).get("name") or "").strip() or f"Anemometro {x['id']}"
        s = station("wind", x["id"], name, lat, lon)
        s["time"] = iso(t)
        s.update(ws=num(m.get("wind_speed_avg")), wg=num(m.get("wind_speed_max")), wd=num(m.get("wind_heading")))
        out.append(s)
    return out


def src_amatoriali():
    """Sensor.Community: sensori amatoriali all'aperto (temperatura, umidita', pressione).
    Sono strumenti economici: vengono confrontati con le stazioni ufficiali vicine (vedi qc_amatoriali)."""
    rows = get_json("https://data.sensor.community/static/v2/data.temp.min.json", timeout=90)
    locs = {}
    for r in rows:
        loc = r.get("location") or {}
        if str(loc.get("indoor")) not in ("0", "False", "false"):
            continue
        lat, lon = num(loc.get("latitude")), num(loc.get("longitude"))
        if not in_bbox(lat, lon) or not r.get("timestamp"):
            continue
        vals = {v.get("value_type"): num(v.get("value")) for v in r.get("sensordatavalues") or []}
        typ = ((r.get("sensor") or {}).get("sensor_type") or {}).get("name", "")
        lid = loc.get("id")
        s = locs.get(lid)
        if not s:
            s = locs[lid] = station("sc", lid, f"Sensore amatoriale {lid}", lat, lon, num(loc.get("altitude")))
        t = iso(datetime.strptime(r["timestamp"], "%Y-%m-%d %H:%M:%S").replace(tzinfo=UTC))
        s["time"] = max(s["time"] or t, t)
        if vals.get("temperature") is not None and s.get("t") is None:
            s["t"] = vals["temperature"]
        h = vals.get("humidity")
        if h is not None and s.get("rh") is None and 3 < h < 99.5:  # i DHT22 bagnati restano fissi a 99,9
            s["rh"] = h
        if vals.get("pressure_at_sealevel") and typ.startswith("BM"):
            s["p"] = vals["pressure_at_sealevel"] / 100
    return list(locs.values())


# Netatmo: stazioni private che i proprietari condividono sulla Weathermap.  Servono una app su
# dev.netatmo.com e tre variabili d'ambiente (NETATMO_CLIENT_ID, NETATMO_CLIENT_SECRET,
# NETATMO_REFRESH_TOKEN); senza, la rete non viene usata.  Netatmo cambia il refresh token a ogni
# rinnovo e invalida il vecchio: l'ultimo si tiene in .netatmo/token.bin, cifrato con il client
# secret (su GitHub il file passa da un'esecuzione all'altra nella cache di Actions).
NT_DIR = os.path.join(ROOT, ".netatmo")
NT_FILE = os.path.join(NT_DIR, "token.bin")
NT_COLS, NT_ROWS = 8, 5  # riquadri dell'area, una richiesta ciascuno (limite Netatmo: 500 all'ora)
NT_CELL = 0.02  # al massimo una stazione Netatmo per cella di ~2 km
NT_LOCK = threading.Lock()


def http_req(url, data=None, headers=None, timeout=40):
    """GET (o POST se ci sono dati di modulo) con risposta JSON; gli errori HTTP riportano il corpo."""
    body = urllib.parse.urlencode(data).encode() if data is not None else None
    req = urllib.request.Request(url, data=body, headers={"User-Agent": UA, **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"HTTP {e.code} {e.read()[:150].decode('utf-8', 'replace')}") from None


def _nt_key(secret):
    return hashlib.sha256(b"meteo-nord-italia/netatmo|" + secret.encode()).digest()


def _nt_xor(key, nonce, data):
    """Cifratura a flusso con HMAC-SHA256 (solo libreria standard)."""
    out = bytearray()
    for i in range(0, len(data), 32):
        ks = hmac.new(key, b"ks" + nonce + i.to_bytes(4, "big"), hashlib.sha256).digest()
        out += bytes(a ^ b for a, b in zip(data[i:i + 32], ks))
    return bytes(out)


def nt_load(secret):
    try:
        with open(NT_FILE, "rb") as f:
            raw = f.read()
    except OSError:
        return {}
    key, nonce, tag, body = _nt_key(secret), raw[:16], raw[16:48], raw[48:]
    if not hmac.compare_digest(tag, hmac.new(key, b"tag" + nonce + body, hashlib.sha256).digest()):
        return {}  # file rovinato o cifrato con un'altra app
    return json.loads(_nt_xor(key, nonce, body))


def nt_save(secret, tok):
    key, nonce = _nt_key(secret), os.urandom(16)
    body = _nt_xor(key, nonce, json.dumps(tok).encode())
    os.makedirs(NT_DIR, exist_ok=True)
    with open(NT_FILE + ".tmp", "wb") as f:
        f.write(nonce + hmac.new(key, b"tag" + nonce + body, hashlib.sha256).digest() + body)
    os.replace(NT_FILE + ".tmp", NT_FILE)


def netatmo_token():
    """Access token valido; lo rinnova (e salva il nuovo refresh token) quando sta per scadere."""
    cid, sec = os.environ["NETATMO_CLIENT_ID"], os.environ["NETATMO_CLIENT_SECRET"]
    seed = os.environ.get("NETATMO_REFRESH_TOKEN", "")
    with NT_LOCK:
        tok = nt_load(sec)
        sh = hashlib.sha256(seed.encode()).hexdigest()[:16]
        if seed and tok.get("seed") != sh:  # chiave nuova, generata dall'utente: si riparte da quella
            tok = {"seed": sh, "refresh": seed}
        if tok.get("access") and tok.get("exp", 0) > time.time() + 600:
            return tok["access"]
        if not tok.get("refresh"):
            raise RuntimeError("manca NETATMO_REFRESH_TOKEN")
        d = http_req("https://api.netatmo.com/oauth2/token", {
            "grant_type": "refresh_token", "refresh_token": tok["refresh"], "client_id": cid, "client_secret": sec})
        tok.update(access=d["access_token"], refresh=d.get("refresh_token") or tok["refresh"],
                   exp=time.time() + int(d.get("expires_in") or 10800))
        nt_save(sec, tok)
        return tok["access"]


def src_netatmo():
    """Netatmo: si tengono temperatura, umidita' e pressione, controllate come i sensori amatoriali
    (qc_amatoriali).  Pioggia e vento dei privati no: pluviometri e anemometri sono spesso mal posti."""
    auth = {"Authorization": "Bearer " + netatmo_token()}
    x0, y0, x1, y1 = BBOX
    dx, dy = (x1 - x0) / NT_COLS, (y1 - y0) / NT_ROWS
    boxes = [(x0 + i * dx, y0 + j * dy) for i in range(NT_COLS) for j in range(NT_ROWS)]

    def one(b):
        q = urllib.parse.urlencode({"lon_sw": f"{b[0]:.3f}", "lat_sw": f"{b[1]:.3f}", "lon_ne": f"{b[0] + dx:.3f}",
                                    "lat_ne": f"{b[1] + dy:.3f}", "required_data": "temperature", "filter": "true"})
        try:
            return http_req("https://api.netatmo.com/api/getpublicdata?" + q, headers=auth).get("body") or []
        except Exception as e:
            return e

    with ThreadPoolExecutor(4) as ex:
        res = list(ex.map(one, boxes))
    errs = [r for r in res if isinstance(r, Exception)]
    if len(errs) == len(res):
        raise errs[0]
    old = time.time() - 2 * 3600
    out = {}
    for body in res:
        for b in [] if isinstance(body, Exception) else body:
            pl = b.get("place") or {}
            loc = pl.get("location") or []
            lon, lat = (num(loc[0]), num(loc[1])) if len(loc) == 2 else (None, None)
            if not in_bbox(lat, lon):
                continue
            vals, last = {}, 0
            for m in (b.get("measures") or {}).values():
                rs, types = m.get("res") or {}, m.get("type") or []
                if not rs or not types:
                    continue
                ts = max(rs, key=int)
                if int(ts) < old:  # modulo che non trasmette piu'
                    continue
                for typ, v in zip(types if isinstance(types, list) else [types], rs[ts]):
                    vals.setdefault(typ, num(v))
                last = max(last, int(ts))
            if vals.get("temperature") is None:
                continue
            sid = hashlib.sha1(str(b.get("_id")).encode()).hexdigest()[:10]  # non si pubblica il MAC
            city = (pl.get("city") or "").strip()
            s = station("nt", sid, f"Netatmo · {city}" if city else "Stazione Netatmo",
                        round(lat, 3), round(lon, 3), num(pl.get("altitude")))
            s["time"] = iso(datetime.fromtimestamp(last, UTC))
            s.update(t=vals.get("temperature"), rh=vals.get("humidity"), p=vals.get("pressure"))
            out[sid] = s  # una stazione sul bordo di due riquadri arriva due volte
    per_box = [len(r) for r in res if not isinstance(r, Exception)]
    print(f"  [nt] {len(boxes)} riquadri ({len(errs)} con errore), al massimo {max(per_box)} stazioni "
          f"in un riquadro, {len(out)} stazioni diverse", flush=True)
    return list(out.values())


def thin(stations, cell=NT_CELL):
    """Nelle citta' le stazioni Netatmo sono decine per chilometro quadrato: se ne tiene una per
    cella di ~2 km, quella con la temperatura piu' vicina alla mediana della cella."""
    groups, out = {}, []
    for s in stations:
        if s["src"] == "nt":
            groups.setdefault((int(s["lon"] // cell), int(s["lat"] // cell)), []).append(s)
        else:
            out.append(s)
    for g in groups.values():
        m = median([s["t"] for s in g if s.get("t") is not None])
        out.append(min(g, key=lambda s: (s.get("t") is None or m is None,
                                         abs(s["t"] - m) if s.get("t") is not None and m is not None else 0,
                                         -len(s))))
    return out


def nearby(index, lat, lon, km):
    """Stazioni dell'indice entro km (indice a celle di 0.25 gradi)."""
    cells = int(km / 20) + 1
    ci, cj = int(lon / 0.25), int(lat / 0.25)
    kx = math.cos(math.radians(lat)) * 111.2
    for i in range(ci - cells, ci + cells + 1):
        for j in range(cj - cells, cj + cells + 1):
            for s in index.get((i, j), ()):
                d = math.hypot((s["lon"] - lon) * kx, (s["lat"] - lat) * 111.2)
                if d <= km:
                    yield d, s


def make_index(stations):
    idx = {}
    for s in stations:
        idx.setdefault((int(s["lon"] / 0.25), int(s["lat"] / 0.25)), []).append(s)
    return idx


def median(v):
    v = sorted(v)
    n = len(v)
    return None if not n else (v[n // 2] if n % 2 else (v[n // 2 - 1] + v[n // 2]) / 2)


def qc_amatoriali(official, amateur):
    """Controllo di qualita' dei sensori amatoriali: confronto con le stazioni ufficiali
    (temperatura riportata alla stessa quota) e con gli altri sensori vicini."""
    oidx = make_index([s for s in official if s.get("t") is not None or s.get("p") is not None])
    aidx = make_index([s for s in amateur if s.get("t") is not None])
    keep = []
    for s in amateur:
        alt = s.get("alt") or 0
        if s.get("t") is not None:
            ref = [o["t"] + 0.0065 * ((o.get("alt") or alt) - alt)
                   for _, o in nearby(oidx, s["lat"], s["lon"], 30) if o.get("t") is not None]
            if len(ref) < 2:  # poche stazioni ufficiali: confronto con gli altri sensori
                ref = [a["t"] + 0.0065 * ((a.get("alt") or alt) - alt)
                       for d, a in nearby(aidx, s["lat"], s["lon"], 15) if a is not s and a.get("t") is not None]
                lim = 4.0 if len(ref) >= 3 else None
            else:
                lim = 3.0
            m = median(ref)
            if lim is None or abs(s["t"] - m) > lim:
                s["t"] = None
                s.pop("td", None)
            if s.get("rh") is not None and s["t"] is None:
                s["rh"] = None
        if s.get("p") is not None:
            ref = [o["p"] for _, o in nearby(oidx, s["lat"], s["lon"], 60) if o.get("p") is not None]
            if len(ref) < 2 or abs(s["p"] - median(ref)) > 2.5:
                s["p"] = None
        if any(s.get(k) is not None for k in ("t", "rh", "p")):
            keep.append(s)
    return keep


def dedupe(stations):
    """Toglie le stazioni di una rete secondaria che coincidono con una gia' presente (entro 250 m)."""
    order = {sid: i for i, (sid, _, _) in enumerate(SOURCES)}
    stations = sorted(stations, key=lambda s: order.get(s["src"], 99))
    idx, out = {}, []
    for s in stations:
        if s["src"] in SECONDARY and any(o["src"] != s["src"] for _, o in nearby(idx, s["lat"], s["lon"], 0.25)):
            continue
        idx.setdefault((int(s["lon"] / 0.25), int(s["lat"] / 0.25)), []).append(s)
        out.append(s)
    return out


SECONDARY = {"slf", "tir", "hr", "wind", "nt", "sc"}
AMATEUR = {"nt", "sc"}  # reti amatoriali: passano dal controllo qc_amatoriali

SOURCES = [
    ("lom", "ARPA Lombardia", src_lombardia),
    ("ven", "ARPA Veneto", src_veneto),
    ("emr", "Arpae Emilia-Romagna", src_emilia),
    ("lig", "ARPAL Liguria (OMIRL)", src_liguria),
    ("tn", "Meteotrentino", src_trentino),
    ("bz", "Provincia di Bolzano (Open Data Hub)", src_altoadige),
    ("ch", "MeteoSvizzera", src_meteoswiss),
    ("at", "GeoSphere Austria", src_geosphere),
    ("si", "ARSO Slovenia", src_arso),
    ("metar", "Aeroporti (METAR)", src_metar),
    ("slf", "SLF Svizzera (stazioni neve IMIS)", src_slf),
    ("tir", "Servizio valanghe Tirolo", src_tirol),
    ("hr", "DHMZ Croazia", src_croazia),
    ("wind", "OpenWindMap (anemometri)", src_vento),
    ("sc", "Sensor.Community (amatoriali, verificati)", src_amatoriali),
]
if os.environ.get("NETATMO_CLIENT_ID") and os.environ.get("NETATMO_CLIENT_SECRET"):
    SOURCES.insert(len(SOURCES) - 1, ("nt", "Netatmo (amatoriali, verificati)", src_netatmo))

FIELDS = ("t", "td", "rh", "p", "pst", "ws", "wg", "wd", "pr", "prm", "rad", "sun", "snow", "cloud",
          "cbase", "vis")
DECIMALS = {"t": 1, "td": 1, "p": 1, "pst": 1, "pr": 1, "ws": 1, "wg": 1, "lat": 4, "lon": 4}


def clean(s):
    """Arrotonda, calcola il punto di rugiada mancante, toglie i campi vuoti."""
    if s.get("td") is None and s.get("t") is not None and s.get("rh"):
        a = math.log(max(s["rh"], 1) / 100) + 17.625 * s["t"] / (243.04 + s["t"])
        s["td"] = 243.04 * a / (17.625 - a)
    if s.get("rh") is not None and not 0 <= s["rh"] <= 100:
        s["rh"] = None
    if s.get("t") is not None and not -60 <= s["t"] <= 55:
        s["t"] = None
    if s.get("wd") is not None and not 0 <= s["wd"] <= 360:
        s["wd"] = None
    if s.get("p") is not None and not 940 <= s["p"] <= 1075:
        s["p"] = None
    if s.get("pr") is None:
        s["prm"] = None
    out = {k: s[k] for k in ("id", "src", "name", "lat", "lon", "alt", "time", "raw") if s.get(k) is not None}
    out["lat"], out["lon"] = round(s["lat"], 4), round(s["lon"], 4)
    for k in FIELDS:
        v = s.get(k)
        if v is not None:
            out[k] = round(v, DECIMALS.get(k, 0)) if DECIMALS.get(k) else int(round(v))
    return out


class Stations:
    def __init__(self):
        self.lock = threading.Lock()
        self.state = {sid: {"id": sid, "name": name, "count": 0, "ok": None, "error": None,
                            "fetched": 0, "data": []} for sid, name, _ in SOURCES}
        self.refreshing = False
        self.payload = None
        self.built = 0

    def _fetch(self, sid, fn):
        st = self.state[sid]
        t0 = time.time()
        try:
            limit = iso(datetime.now(UTC) - timedelta(hours=MAX_AGE_H))
            data = [clean(s) for s in fn() if s.get("time") and s["time"] >= limit]
            data = [s for s in data if any(k in s for k in ("t", "pr", "ws", "rh", "p"))]
            with self.lock:
                st.update(data=data, count=len(data), ok=True, error=None, fetched=time.time())
            print(f"  [{sid}] {len(data)} stazioni in {time.time()-t0:.1f}s", flush=True)
        except Exception as e:  # la rete di una regione puo' essere giu': si tiene l'ultimo dato
            with self.lock:
                st.update(ok=False, error=f"{type(e).__name__}: {e}"[:200], fetched=time.time())
            print(f"  [{sid}] ERRORE {type(e).__name__}: {e}", flush=True)

    def refresh(self):
        with self.lock:
            if self.refreshing:
                return
            self.refreshing = True
        try:
            print("Aggiorno le stazioni...", flush=True)
            with ThreadPoolExecutor(len(SOURCES)) as ex:
                for sid, _, fn in SOURCES:
                    ex.submit(self._fetch, sid, fn)
            self._build()
        finally:
            self.refreshing = False

    def _build(self):
        with self.lock:
            stations = [s for st in self.state.values() if st["id"] not in AMATEUR for s in st["data"]]
            amateur = [dict(s) for st in self.state.values() if st["id"] in AMATEUR for s in st["data"]]
            sources = [{k: st[k] for k in ("id", "name", "count", "ok", "error")} for st in self.state.values()]
        amateur = thin([{k: v for k, v in s.items() if v is not None} for s in qc_amatoriali(stations, amateur)])
        stations = dedupe(stations + amateur)
        counts = {}
        for s in stations:
            counts[s["src"]] = counts.get(s["src"], 0) + 1
        for src in sources:
            src["count"] = counts.get(src["id"], 0)
        body = json.dumps({"updated": iso(datetime.now(UTC)), "sources": sources, "stations": stations},
                          ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.payload = gzip.compress(body, 5)
        self.built = time.time()

    def get(self):
        if self.payload is None:
            self.refresh()
            if self.payload is None:  # un altro thread sta gia' caricando
                while self.refreshing or self.payload is None:
                    time.sleep(0.3)
        elif time.time() - self.built > STATIONS_TTL and not self.refreshing:
            threading.Thread(target=self.refresh, daemon=True).start()
        return self.payload


ENS_POINTS = [(45.07, 7.69), (45.46, 9.19), (44.41, 8.93), (44.49, 11.34), (45.44, 12.33), (46.07, 11.12),
              (46.50, 11.35), (46.06, 13.24), (45.74, 7.32), (45.44, 10.99), (46.00, 8.95), (47.26, 11.39)]


def ensemble_uncertainty():
    """Quota (%) di scenari dell'ensemble ECMWF (51 membri) che divergono dallo scenario
    centrale: temperatura oltre +-2 gradi dalla mediana oppure pioggia si/no diversa dalla
    maggioranza.  Media su 12 punti dell'area.  Ritorna {unixtime: percentuale}."""
    url = ("https://ensemble-api.open-meteo.com/v1/ensemble?latitude=" + ",".join(str(p[0]) for p in ENS_POINTS) +
           "&longitude=" + ",".join(str(p[1]) for p in ENS_POINTS) +
           "&hourly=temperature_2m,precipitation&models=ecmwf_ifs025&forecast_days=8&timeformat=unixtime&timezone=GMT")
    d = get_json(url, 90)
    acc = {}
    for loc in d:
        h = loc["hourly"]
        tk = sorted(k for k in h if k.startswith("temperature_2m"))
        pk = sorted(k for k in h if k.startswith("precipitation"))
        for i, ts in enumerate(h["time"]):
            pairs = [(h[a][i], h[b][i]) for a, b in zip(tk, pk) if h[a][i] is not None]
            if len(pairs) < 10:
                continue
            temps = sorted(p[0] for p in pairs)
            med = temps[len(temps) // 2]
            wet = [(p[1] or 0) >= 0.1 for p in pairs]
            major = sum(wet) * 2 >= len(wet)
            diff = sum(1 for p, w in zip(pairs, wet) if abs(p[0] - med) > 2 or w != major)
            acc.setdefault(ts, []).append(100.0 * diff / len(pairs))
    return {ts: sum(v) / len(v) for ts, v in acc.items()}


SNOW_VARS = ["snowfall", "snow_depth"]


def snow_types(h):
    """Stima il tipo di neve al suolo ora per ora dalla storia recente del modello.
    0 nessuna, 1 fresca polverosa, 2 umida/bagnata, 3 dura compatta, 4 ghiacciata (crosta), 5 fradicia in fusione.
    E' una stima: nessuna rete misura lo stato del manto in tempo reale."""
    T, P, SF, SD = h["temperature_2m"], h["precipitation"], h["snowfall"], h["snow_depth"]
    out = []
    for k in range(len(T)):
        t, depth = T[k], SD[k]
        if t is None or depth is None:
            out.append(None)
            continue
        if depth < 0.01:
            out.append(0)
            continue
        a24, a48 = max(0, k - 23), max(0, k - 47)
        new24 = sum(x or 0 for x in SF[a24:k + 1])
        rain = [max(0.0, (P[i] or 0) - (SF[i] or 0) / 0.7) for i in range(a48, k + 1)]
        rain24, rain48 = sum(rain[-24:]), sum(rain)
        thaw24 = sum(1 for x in T[a24:k + 1] if x is not None and x > 0.5)
        thaw48 = sum(1 for x in T[a48:k + 1] if x is not None and x > 0.5)
        if t > 1 and (thaw24 >= 6 or rain24 >= 2):
            c = 5
        elif new24 >= 3:
            c = 1 if t <= -1 else 2
        elif t <= -1 and (thaw48 >= 3 or rain48 >= 1):
            c = 4
        elif t > 0:
            c = 2
        else:
            c = 3
        out.append(c)
    return out


class Grid:
    def __init__(self):
        self.lock = threading.Lock()
        self.payload = None
        self.built = 0
        self.path = os.path.join(CACHE_DIR, "grid8.json.gz")
        if os.path.exists(self.path):
            self.payload = open(self.path, "rb").read()
            self.built = os.path.getmtime(self.path)

    def build(self):
        g = GRID
        nx = int(round((g["lon1"] - g["lon0"]) / g["step"])) + 1
        ny = int(round((g["lat1"] - g["lat0"]) / g["step"])) + 1
        pts = [(round(g["lat0"] + j * g["step"], 3), round(g["lon0"] + i * g["step"], 3))
               for j in range(ny) for i in range(nx)]
        print(f"Aggiorno la griglia previsionale ({nx}x{ny} punti, 7 giorni)...", flush=True)
        res = [None] * len(pts)
        elev = [0] * len(pts)
        chunk = 90

        def one(i0):
            part = pts[i0:i0 + chunk]
            url = ("https://api.open-meteo.com/v1/forecast?latitude=" + ",".join(str(p[0]) for p in part) +
                   "&longitude=" + ",".join(str(p[1]) for p in part) + "&hourly=" + ",".join(GRID_VARS + SNOW_VARS) +
                   "&past_hours=72&forecast_hours=168&timeformat=unixtime&wind_speed_unit=kmh&timezone=GMT")
            for attempt in range(5):
                try:
                    d = get_json(url, 90)
                    break
                except Exception:
                    if attempt == 4:
                        raise
                    time.sleep(4 + attempt * 8)
            for k, loc in enumerate(d if isinstance(d, list) else [d]):
                res[i0 + k] = loc["hourly"]
                elev[i0 + k] = int(round(loc.get("elevation") or 0))

        with ThreadPoolExecutor(3) as ex:
            list(ex.map(one, range(0, len(pts), chunk)))
        all_times = res[0]["time"]
        now = time.time()
        # orario per 48 ore, poi un passo ogni 3 ore fino a 7 giorni
        keep = [i for i, t in enumerate(all_times)
                if t >= now - 3.6 * 3600 and (t <= now + 48 * 3600 or (t // 3600) % 3 == 0)]
        times = [all_times[i] for i in keep]
        try:
            unc_map = ensemble_uncertainty()
        except Exception as e:
            print(f"Ensemble: ERRORE {type(e).__name__}: {e}", flush=True)
            unc_map = {}
        unc = [round(unc_map[t]) if t in unc_map and t > now - 1800 else None for t in times]
        out = {"lon0": g["lon0"], "lat0": g["lat0"], "step": g["step"], "nx": nx, "ny": ny, "times": times,
               "elev": elev, "unc": unc, "updated": iso(datetime.now(UTC)), "vars": {}}
        for v in GRID_VARS:
            dec = 1 if v in ("temperature_2m", "precipitation", "pressure_msl") else 0
            frames = []
            for ti in keep:
                row = []
                for h in res:
                    x = h[v][ti] if ti < len(h[v]) else None
                    row.append(None if x is None else (round(x, 1) if dec else int(round(x))))
                frames.append(row)
            out["vars"][v] = frames
        # neve: nevicata oraria (cm), altezza al suolo (cm) e tipo stimato del manto
        types = [snow_types(h) for h in res]
        out["vars"]["snowfall"] = [[None if h["snowfall"][ti] is None else round(h["snowfall"][ti], 1) for h in res]
                                   for ti in keep]
        out["vars"]["snow_depth"] = [[None if h["snow_depth"][ti] is None else int(round(h["snow_depth"][ti] * 100))
                                      for h in res] for ti in keep]
        out["vars"]["snow_type"] = [[tp[ti] for tp in types] for ti in keep]
        payload = gzip.compress(json.dumps(out, separators=(",", ":")).encode("utf-8"), 6)
        os.makedirs(CACHE_DIR, exist_ok=True)
        with open(self.path, "wb") as f:
            f.write(payload)
        self.payload, self.built = payload, time.time()
        print(f"Griglia pronta ({len(payload)//1024} kB, {len(times)} passi)", flush=True)

    def get(self):
        with self.lock:
            if self.payload is None or time.time() - self.built > GRID_TTL:
                try:
                    self.build()
                except Exception as e:
                    print(f"Griglia: ERRORE {type(e).__name__}: {e}", flush=True)
                    if self.payload is None:
                        raise
                    self.built = time.time() - GRID_TTL + 600  # riprova fra 10 minuti
            return self.payload


# ------------------------------------------------------------------ rilievo
def read_png_rgb(data):
    """Decodifica minima di un PNG 8 bit RGB/RGBA (senza librerie esterne)."""
    import struct
    import zlib
    pos, idat, w, h, ctype = 8, b"", 0, 0, 2
    while pos < len(data):
        ln, kind = struct.unpack(">I4s", data[pos:pos + 8])
        body = data[pos + 8:pos + 8 + ln]
        if kind == b"IHDR":
            w, h, depth, ctype = struct.unpack(">IIBB", body[:10])
            if depth != 8 or ctype not in (2, 6):
                raise ValueError("formato PNG non previsto")
        elif kind == b"IDAT":
            idat += body
        pos += ln + 12
    bpp = 3 if ctype == 2 else 4
    raw = zlib.decompress(idat)
    stride = w * bpp
    rows, prev = [], bytearray(stride)
    for y in range(h):
        f = raw[y * (stride + 1)]
        cur = bytearray(raw[y * (stride + 1) + 1:(y + 1) * (stride + 1)])
        for i in range(stride):
            a = cur[i - bpp] if i >= bpp else 0
            b = prev[i]
            c = prev[i - bpp] if i >= bpp else 0
            if f == 1:
                cur[i] = (cur[i] + a) & 255
            elif f == 2:
                cur[i] = (cur[i] + b) & 255
            elif f == 3:
                cur[i] = (cur[i] + ((a + b) >> 1)) & 255
            elif f == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                cur[i] = (cur[i] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        rows.append(cur)
        prev = cur
    return w, bpp, rows


def build_dem():
    """Scarica una volta il rilievo (tile Terrarium) e lo salva in web/data/dem.json."""
    z, step = 6, 0.025
    g = GRID
    nx = int(round((g["lon1"] - g["lon0"]) / step)) + 1
    ny = int(round((g["lat1"] - g["lat0"]) / step)) + 1
    tiles = {}

    def tile(tx, ty):
        if (tx, ty) not in tiles:
            print(f"  tile {z}/{tx}/{ty}", flush=True)
            tiles[(tx, ty)] = read_png_rgb(http_get(
                f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{tx}/{ty}.png", 60))
        return tiles[(tx, ty)]

    out = []
    n = 2 ** z * 256
    for j in range(ny):
        lat = math.radians(g["lat0"] + j * step)
        py = (1 - math.log(math.tan(lat) + 1 / math.cos(lat)) / math.pi) / 2 * n
        for i in range(nx):
            px = (g["lon0"] + i * step + 180) / 360 * n
            w, bpp, rows = tile(int(px // 256), int(py // 256))
            r = rows[int(py % 256)]
            o = int(px % 256) * bpp
            out.append(max(0, int(round(r[o] * 256 + r[o + 1] + r[o + 2] / 256 - 32768))))
    os.makedirs(os.path.join(WEB, "data"), exist_ok=True)
    with open(os.path.join(WEB, "data", "dem.json"), "w") as f:
        json.dump({"lon0": g["lon0"], "lat0": g["lat0"], "step": step, "nx": nx, "ny": ny, "z": out}, f,
                  separators=(",", ":"))
    print(f"Rilievo salvato: {nx}x{ny} punti, quota massima {max(out)} m", flush=True)


def build_static():
    """Scrive i dati come file statici in web/data (per la pubblicazione su un sito statico)."""
    ddir = os.path.join(WEB, "data")
    os.makedirs(ddir, exist_ok=True)
    STATIONS.refresh()
    with open(os.path.join(ddir, "stations.json"), "wb") as f:
        f.write(gzip.decompress(STATIONS.payload))
    gpath = os.path.join(ddir, "grid.json")
    fresh = False
    if os.path.exists(gpath):  # griglia precedente ancora valida: non si riscarica
        try:
            old = json.load(open(gpath, encoding="utf-8"))
            age = time.time() - datetime.fromisoformat(old["updated"].replace("Z", "+00:00")).timestamp()
            fresh = age < GRID_TTL and "snow_type" in old.get("vars", {})
            print(f"Griglia esistente di {age/3600:.1f} ore fa: {'la tengo' if fresh else 'la rifaccio'}", flush=True)
        except Exception:
            pass
    if not fresh:
        try:
            GRIDDATA.build()
            with open(gpath, "wb") as f:
                f.write(gzip.decompress(GRIDDATA.payload))
        except Exception as e:
            print(f"Griglia: ERRORE {type(e).__name__}: {e}", flush=True)
            if not os.path.exists(gpath):
                raise
    if not os.path.exists(os.path.join(ddir, "dem.json")):
        build_dem()


STATIONS = Stations()
GRIDDATA = Grid()


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=WEB, **kw)

    def log_message(self, fmt, *args):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def send_gz(self, payload):
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Encoding", "gzip")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        path = self.path.split("?")[0]
        try:
            if path == "/data/stations.json":
                return self.send_gz(STATIONS.get())
            if path == "/data/grid.json":
                return self.send_gz(GRIDDATA.get())
        except Exception as e:
            msg = json.dumps({"error": f"{type(e).__name__}: {e}"}).encode()
            self.send_response(502)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(msg)))
            self.end_headers()
            self.wfile.write(msg)
            return
        return super().do_GET()


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "test":  # prova le sorgenti senza avviare il server
        STATIONS.refresh()
        final = json.loads(gzip.decompress(STATIONS.payload))
        kept = {s["id"]: s["count"] for s in final["sources"]}
        for st in STATIONS.state.values():
            print(f"{st['id']:6} scaricate {len(st['data']):5}  pubblicate {kept.get(st['id'], 0):5}  {st['error'] or 'ok'}")
            if st["data"]:
                print("       es:", json.dumps(st["data"][len(st["data"]) // 2], ensure_ascii=False))
        print("Totale stazioni pubblicate:", len(final["stations"]))
        return
    if len(sys.argv) > 1 and sys.argv[1] == "dem":  # rigenera il file del rilievo
        return build_dem()
    if len(sys.argv) > 1 and sys.argv[1] == "build":  # dati statici per la pubblicazione
        return build_static()
    if not os.path.exists(os.path.join(WEB, "data", "dem.json")):
        build_dem()
    threading.Thread(target=STATIONS.refresh, daemon=True).start()
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Meteo Nord Italia -> http://localhost:{PORT}", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
