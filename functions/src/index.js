// MarsInterloper Cloudflare Worker: game state, MOLA terrain, Mars night sky, multiplayer, and R2 assets.
//
// Plain JavaScript on purpose: the previous Go/WASM build booted a fresh Go runtime on every
// request and read whole 130MB MOLA tiles to answer single-point queries, which blew through the
// Workers free-plan CPU and memory limits. Everything here reads only the bytes it needs from R2.

import { BRIGHT_STARS, STAR_COLORS } from "./bright-stars.js";
import { MultiplayerRoom } from "./multiplayer.js";

export { MultiplayerRoom };

const MANIFEST_KEY = "assets/mars_data/meg128_manifest.json";

const MAX_RESOLUTION = 512;
const MAX_CHUNK_POINTS = MAX_RESOLUTION * MAX_RESOLUTION;
// Source rows closer than this are fetched in one contiguous range read instead of separately.
const BAND_MAX_ROW_GAP = 4;
const BAND_MAX_BYTES = 4 * 1024 * 1024;
// Free plan allows 1,000 subrequests to Cloudflare services per invocation; leave headroom.
const MAX_RANGE_READS = 900;
const R2_CONCURRENCY = 4;

const TERRAIN_CACHE_CONTROL = "public, max-age=86400";
// Bump when chunk contents change so stale edge-cached chunks are not served.
const TERRAIN_CACHE_VERSION = 2;
const SKY_CACHE_CONTROL = "public, max-age=3600";
const ASSET_CACHE_CONTROL = "public, max-age=3600";

const ASSET_CONTENT_TYPES = {
	glb: "model/gltf-binary",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	png: "image/png",
	json: "application/json",
	csv: "text/csv; charset=utf-8",
};

// Parsed terrain manifest, shared by requests served from the same isolate.
let manifestPromise;

export default {
	async fetch(request, env, ctx) {
		const url = new URL(request.url);
		const path = url.pathname;

		if (path.startsWith("/assets/")) return handleAsset(request, env, path);

		switch (path) {
			case "/ws":
				return handleMultiplayer(request, env);
			case "/api/health":
				return handleHealth(request, env);
			case "/api/game-state":
				return handleGameState(request, env);
			case "/api/interact":
				return handleInteraction(request, env);
			case "/api/reset":
				return handleReset(request, env);
			case "/api/mars/elevation":
				return handleMarsElevation(request, env, url);
			case "/api/mars/chunk":
				return handleMarsChunk(request, env, ctx, url);
			case "/api/mars/sky":
				return handleMarsSky(request, env, url);
			default:
				return textError("404 page not found", 404);
		}
	},
};

// ---------------------------------------------------------------------------
// Response helpers

function corsHeaders(env) {
	return {
		"Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type, X-API-Key",
	};
}

function preflight(env) {
	return new Response(null, { status: 200, headers: corsHeaders(env) });
}

function jsonResponse(env, body, extraHeaders = {}) {
	const payload = typeof body === "string" ? body : JSON.stringify(body);
	return new Response(payload, {
		headers: { ...corsHeaders(env), "Content-Type": "application/json", ...extraHeaders },
	});
}

function textError(message, status, env) {
	return new Response(message + "\n", {
		status,
		headers: {
			...(env ? corsHeaders(env) : {}),
			"Content-Type": "text/plain; charset=utf-8",
			"X-Content-Type-Options": "nosniff",
		},
	});
}

// Strict decimal float parse; rejects "", "12abc", and other input Number() would coerce.
function parseFloatStrict(value) {
	if (value === null || !/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(value)) return NaN;
	return Number(value);
}

function parseIntStrict(value) {
	if (value === null || !/^[+-]?\d+$/.test(value)) return NaN;
	return Number(value);
}

// Serve from the colo's edge cache, or build the response and cache it for next time.
async function cached(ctx, cacheKey, build) {
	const cache = caches.default;
	const hit = await cache.match(cacheKey);
	if (hit) return { response: hit, hit: true };
	const response = await build();
	// Only successful responses that declare a TTL; errors and fallbacks are retried next time.
	if (response.ok && response.headers.has("Cache-Control")) ctx.waitUntil(cache.put(cacheKey, response.clone()));
	return { response, hit: false };
}

// ---------------------------------------------------------------------------
// Health and game state

function handleHealth(request, env) {
	if (request.method === "OPTIONS") return preflight(env);
	return jsonResponse(
		env,
		{ service: "cloudflare-worker", status: "healthy" },
		{ "Cache-Control": "no-store, no-cache, must-revalidate" },
	);
}

// Workers are stateless, so each request starts from the default game state.
function defaultGameState() {
	return {
		playerLocation: "hab_living_quarters",
		interactions: {},
		inventory: [],
		storyProgress: {},
	};
}

function handleGameState(request, env) {
	if (request.method === "OPTIONS") return preflight(env);
	if (request.method !== "GET") return textError("Method not allowed", 405, env);
	return jsonResponse(env, defaultGameState());
}

async function handleInteraction(request, env) {
	if (request.method === "OPTIONS") return preflight(env);
	if (request.method !== "POST") return textError("Method not allowed", 405, env);

	let interaction;
	try {
		interaction = await request.json();
	} catch {
		return textError("Invalid request body", 400, env);
	}
	if (interaction === null || typeof interaction !== "object" || Array.isArray(interaction)) {
		return textError("Invalid request body", 400, env);
	}
	const objectId = typeof interaction.objectId === "string" ? interaction.objectId : "";
	const action = typeof interaction.action === "string" ? interaction.action : "";

	const state = defaultGameState();
	state.interactions[`${objectId}_${action}`] = true;
	if (objectId === "solar_panel" && action === "repair") {
		state.storyProgress.solar_panel_repaired = "true";
	}
	if (objectId === "strange_rock" && action === "collect") {
		state.inventory.push("strange_rock");
	}
	return jsonResponse(env, state);
}

function handleReset(request, env) {
	if (request.method === "OPTIONS") return preflight(env);
	if (request.method !== "POST") return textError("Method not allowed", 405, env);
	return jsonResponse(env, defaultGameState());
}

// ---------------------------------------------------------------------------
// MOLA terrain

function loadManifest(env) {
	if (!manifestPromise) {
		manifestPromise = (async () => {
			const obj = await env.ASSETS_BUCKET.get(MANIFEST_KEY);
			if (!obj) throw new Error(`manifest ${MANIFEST_KEY} not found in R2`);
			return (await obj.json()).map(withTileBounds);
		})();
		manifestPromise.catch(() => {
			manifestPromise = undefined;
		});
	}
	return manifestPromise;
}

// MEGDR tile names encode the tile's northern edge and western longitude: megt44n000hb.img covers
// 0-44N, megt00n000hb.img 0-44S, and megt44s000hb.img 44S-88S. The manifest in R2 lists megt44s
// as 0-44S, so bounds are taken from the name whenever it follows that pattern.
function withTileBounds(file) {
	const match = /meg[a-z](\d{2})([ns])(\d{3})/i.exec(file.r2Key.split("/").pop());
	if (!match) return file;
	const maxLat = Number(match[1]) * (match[2].toLowerCase() === "n" ? 1 : -1);
	const minLon = Number(match[3]);
	return {
		...file,
		maxLat,
		minLat: maxLat - file.height / file.pixelsPerDeg,
		minLon,
		maxLon: minLon + file.width / file.pixelsPerDeg,
	};
}

function normalizeLon(lon) {
	lon %= 360;
	return lon < 0 ? lon + 360 : lon;
}

function latInFile(file, lat) {
	return lat >= file.minLat && lat <= file.maxLat;
}

function lonInFile(file, lon) {
	if (file.minLon <= file.maxLon) return lon >= file.minLon && lon <= file.maxLon;
	return lon >= file.minLon || lon <= file.maxLon;
}

// First manifest entry covering the point, or -1. `lon` must already be normalized to [0, 360).
function findFileIndex(files, lat, lon) {
	for (let i = 0; i < files.length; i++) {
		if (latInFile(files[i], lat) && lonInFile(files[i], lon)) return i;
	}
	return -1;
}

function clamp(value, max) {
	return value < 0 ? 0 : value >= max ? max - 1 : value;
}

function pixelX(file, lon) {
	return clamp(Math.trunc(((lon - file.minLon) / (file.maxLon - file.minLon)) * file.width), file.width);
}

// MEGDR rows run from the tile's northern edge (row 0) southward.
function pixelY(file, lat) {
	return clamp(Math.trunc(((file.maxLat - lat) / (file.maxLat - file.minLat)) * file.height), file.height);
}

function sampleFormat(file) {
	const unsigned = file.sampleType === "MSB_UNSIGNED_INTEGER";
	if (!unsigned && file.sampleType !== "MSB_INTEGER") {
		console.warn(`Unknown sample type '${file.sampleType}' for file ${file.r2Key}, decoding as MSB_INTEGER`);
	}
	return { unsigned, scale: file.scalingFactor ?? 1, offset: file.offset ?? 0 };
}

function readSample(view, byteOffset, format) {
	const raw = format.unsigned ? view.getUint16(byteOffset) : view.getInt16(byteOffset);
	return raw * format.scale + format.offset;
}

async function handleMarsElevation(request, env, url) {
	if (request.method === "OPTIONS") return preflight(env);

	const lat = parseFloatStrict(url.searchParams.get("lat"));
	const lon = parseFloatStrict(url.searchParams.get("lon"));
	if (Number.isNaN(lat) || Number.isNaN(lon)) {
		return textError("Invalid latitude or longitude format", 400, env);
	}

	let files;
	try {
		files = await loadManifest(env);
	} catch (err) {
		return textError(`Terrain data system not ready: ${err.message}`, 503, env);
	}

	const normLon = normalizeLon(lon);
	const fileIndex = findFileIndex(files, lat, normLon);
	if (fileIndex < 0) {
		return textError(
			`No data for location: no terrain data available for location (${lat.toFixed(4)}, ${lon.toFixed(4)}) in manifest`,
			404,
			env,
		);
	}

	const file = files[fileIndex];
	const px = pixelX(file, normLon);
	const py = pixelY(file, lat);
	let obj;
	try {
		obj = await env.ASSETS_BUCKET.get(file.r2Key, { range: { offset: (py * file.width + px) * 2, length: 2 } });
	} catch (err) {
		return textError(`Failed to read elevation value: ${err.message}`, 500, env);
	}
	if (!obj) return textError(`Failed to read elevation value: R2 object ${file.r2Key} not found`, 500, env);

	const view = new DataView(await obj.arrayBuffer());
	return jsonResponse(env, {
		latitude: lat,
		longitude: lon,
		elevation: readSample(view, 0, sampleFormat(file)),
		source: `r2:/ASSETS_BUCKET/${file.r2Key} (pixel: ${px},${py})`,
	});
}

async function handleMarsChunk(request, env, ctx, url) {
	if (request.method === "OPTIONS") return preflight(env);

	const params = url.searchParams;
	const names = ["minLat", "maxLat", "minLon", "maxLon", "resolution"];
	if (names.some((name) => !params.get(name))) {
		return textError("Missing query parameters: minLat, maxLat, minLon, maxLon, resolution are required", 400, env);
	}
	const minLat = parseFloatStrict(params.get("minLat"));
	const maxLat = parseFloatStrict(params.get("maxLat"));
	const minLon = parseFloatStrict(params.get("minLon"));
	const maxLon = parseFloatStrict(params.get("maxLon"));
	const resolution = parseIntStrict(params.get("resolution"));
	if ([minLat, maxLat, minLon, maxLon, resolution].some(Number.isNaN)) {
		return textError("Invalid query parameter format", 400, env);
	}
	if (resolution < 1 || resolution > MAX_RESOLUTION) {
		return textError(`Resolution must be between 1 and ${MAX_RESOLUTION}`, 400, env);
	}

	// A chunk may cross the 0/360 meridian, e.g. minLon=359, maxLon=1.
	let lonSpan = normalizeLon(maxLon) - normalizeLon(minLon);
	if (lonSpan < 0) lonSpan += 360;
	if (lonSpan === 0) return textError("Invalid query parameter format", 400, env);

	const width = resolution;
	const height = Math.max(1, Math.trunc((resolution * (maxLat - minLat)) / lonSpan));
	if (width * height > MAX_CHUNK_POINTS) {
		return textError("Requested chunk is too large; reduce the latitude span or resolution", 400, env);
	}

	const cacheKey = new Request(
		`${url.origin}/api/mars/chunk?` +
			new URLSearchParams({ minLat, maxLat, minLon, maxLon, resolution, v: TERRAIN_CACHE_VERSION }).toString(),
	);
	const { response, hit } = await cached(ctx, cacheKey, async () => {
		let files;
		try {
			files = await loadManifest(env);
		} catch (err) {
			return textError(`Terrain data system not ready: ${err.message}`, 503, env);
		}
		let elevation;
		try {
			elevation = await sampleChunk(env, files, minLat, maxLat, minLon, lonSpan, width, height);
		} catch (err) {
			return textError(`Failed to read terrain chunk: ${err.message}`, err.status || 500, env);
		}
		const body = encodeJsonWithNumbers(
			`{"minLat":${minLat},"maxLat":${maxLat},"minLon":${minLon},"maxLon":${maxLon},` +
				`"width":${width},"height":${height},"elevation":[`,
			elevation,
			width,
			"]}",
		);
		return new Response(body, {
			headers: { ...corsHeaders(env), "Content-Type": "application/json", "Cache-Control": TERRAIN_CACHE_CONTROL },
		});
	});

	if (!response.ok) return response;
	const out = new Response(response.body, response);
	out.headers.set("X-Cache-Status", hit ? "HIT" : "MISS");
	return out;
}

// Samples a width x height grid (row 0 = minLat, column 0 = minLon), reading only the rows it
// needs from each MOLA tile via R2 range requests.
async function sampleChunk(env, files, minLat, maxLat, minLon, lonSpan, width, height) {
	const elevation = new Float64Array(width * height);
	const lons = new Float64Array(width);
	for (let x = 0; x < width; x++) lons[x] = normalizeLon(minLon + lonSpan * (x / width));

	// Per file: pixel column for each output column, and the output rows it contributes to.
	const perFile = files.map(() => null);
	const fileInfo = (fi) =>
		(perFile[fi] ??= { cols: new Int32Array(width).fill(-1), minCol: Infinity, maxCol: -1, rows: [] });

	// Which file covers each column depends only on which files cover the row's latitude, so the
	// column mapping is computed once per distinct candidate set rather than once per point.
	const layouts = new Map();
	const layoutFor = (candidates) => {
		const key = candidates.join(",");
		let layout = layouts.get(key);
		if (layout) return layout;
		layout = { colFile: new Int16Array(width).fill(-1), files: [] };
		for (let x = 0; x < width; x++) {
			const fi = candidates.find((c) => lonInFile(files[c], lons[x]));
			if (fi === undefined) continue;
			layout.colFile[x] = fi;
			if (!layout.files.includes(fi)) layout.files.push(fi);
			const info = fileInfo(fi);
			if (info.cols[x] < 0) {
				const px = pixelX(files[fi], lons[x]);
				info.cols[x] = px;
				if (px < info.minCol) info.minCol = px;
				if (px > info.maxCol) info.maxCol = px;
			}
		}
		layouts.set(key, layout);
		return layout;
	};

	const rowLayout = new Array(height);
	for (let y = 0; y < height; y++) {
		const lat = minLat + (maxLat - minLat) * (y / height);
		const candidates = [];
		for (let fi = 0; fi < files.length; fi++) {
			if (latInFile(files[fi], lat)) candidates.push(fi);
		}
		const layout = (rowLayout[y] = layoutFor(candidates));
		for (const fi of layout.files) fileInfo(fi).rows.push({ y, py: pixelY(files[fi], lat) });
	}

	// Group nearby source rows into contiguous range reads.
	const reads = [];
	perFile.forEach((info, fi) => {
		if (!info) return;
		const rows = info.rows.slice().sort((a, b) => a.py - b.py);
		const stride = files[fi].width * 2;
		let band = null;
		for (const row of rows) {
			if (
				band &&
				row.py - band.pyEnd <= BAND_MAX_ROW_GAP &&
				(row.py - band.pyStart + 1) * stride <= BAND_MAX_BYTES
			) {
				band.pyEnd = row.py;
				band.rows.push(row);
			} else {
				band = { fi, info, pyStart: row.py, pyEnd: row.py, rows: [row] };
				reads.push(band);
			}
		}
	});
	if (reads.length > MAX_RANGE_READS) {
		throw Object.assign(new Error("requested chunk spans too many terrain rows"), { status: 400 });
	}

	await forEachLimited(reads, R2_CONCURRENCY, async (band) => {
		const file = files[band.fi];
		const { cols, minCol, maxCol } = band.info;
		const offset = (band.pyStart * file.width + minCol) * 2;
		const length = ((band.pyEnd - band.pyStart) * file.width + (maxCol - minCol + 1)) * 2;
		const obj = await env.ASSETS_BUCKET.get(file.r2Key, { range: { offset, length } });
		if (!obj) return; // Missing tile: leave these points at 0, as the Go server did.
		const view = new DataView(await obj.arrayBuffer());
		const format = sampleFormat(file);
		let prev = null;
		for (const row of band.rows) {
			const layout = rowLayout[row.y];
			const start = row.y * width;
			// Upsampled requests hit the same source row several times; copy it when the whole
			// output row comes from this one file.
			if (prev && prev.py === row.py && rowLayout[prev.y] === layout && layout.files.length === 1) {
				elevation.copyWithin(start, prev.y * width, prev.y * width + width);
			} else {
				const { colFile } = layout;
				const rowBase = (row.py - band.pyStart) * file.width - minCol;
				for (let x = 0; x < width; x++) {
					if (colFile[x] !== band.fi) continue;
					// Neighbouring columns often map to the same source pixel.
					elevation[start + x] =
						x > 0 && colFile[x - 1] === band.fi && cols[x - 1] === cols[x]
							? elevation[start + x - 1]
							: readSample(view, (rowBase + cols[x]) * 2, format);
				}
			}
			prev = row;
		}
	});

	return elevation;
}

// Serializes `values` (row-major, `width` per row) as a comma-separated JSON number list between
// `prefix` and `suffix`, straight into bytes. A 512x512 chunk is ~262k numbers and most of them
// repeat whole rows (the frontend asks for 512 samples over 256 source pixels), so repeated rows
// are copied instead of re-encoded. This is several times cheaper than join() or JSON.stringify.
function encodeJsonWithNumbers(prefix, values, width, suffix) {
	const encoder = new TextEncoder();
	let buf = new Uint8Array(prefix.length * 3 + values.length * 7 + 64);
	let pos = encoder.encodeInto(prefix, buf).written;
	const ensure = (extra) => {
		if (pos + extra <= buf.length) return;
		const grown = new Uint8Array(Math.max(buf.length * 2, pos + extra));
		grown.set(buf.subarray(0, pos));
		buf = grown;
	};

	let prevStart = 0;
	let prevEnd = 0;
	for (let row = 0; row < values.length; row += width) {
		if (row > 0) {
			ensure(1);
			buf[pos++] = 44; // ","
			if (rowsEqual(values, row - width, row, width)) {
				const len = prevEnd - prevStart;
				ensure(len);
				buf.copyWithin(pos, prevStart, prevEnd);
				prevStart = pos;
				pos += len;
				prevEnd = pos;
				continue;
			}
		}
		ensure(width * 25);
		prevStart = pos;
		let lastValue = NaN;
		let lastStart = 0;
		let lastEnd = 0;
		for (let x = 0; x < width; x++) {
			if (x > 0) buf[pos++] = 44;
			const v = values[row + x];
			if (v === lastValue) {
				for (let k = lastStart; k < lastEnd; k++) buf[pos++] = buf[k];
				continue;
			}
			lastValue = v;
			lastStart = pos;
			const n = v | 0;
			if (n === v) {
				pos = writeInt(buf, pos, n);
			} else {
				const s = String(v);
				for (let k = 0; k < s.length; k++) buf[pos++] = s.charCodeAt(k);
			}
			lastEnd = pos;
		}
		prevEnd = pos;
	}

	ensure(suffix.length * 3);
	pos += encoder.encodeInto(suffix, buf.subarray(pos)).written;
	return buf.subarray(0, pos);
}

function rowsEqual(values, a, b, width) {
	for (let x = 0; x < width; x++) if (values[a + x] !== values[b + x]) return false;
	return true;
}

// Writes an int32 as ASCII digits using integer-only arithmetic.
function writeInt(buf, pos, n) {
	if (n < 0) {
		buf[pos++] = 45; // "-"
		n = -n;
	}
	const digits =
		n < 10 ? 1 : n < 100 ? 2 : n < 1e3 ? 3 : n < 1e4 ? 4 : n < 1e5 ? 5 : n < 1e6 ? 6 : n < 1e7 ? 7 : n < 1e8 ? 8 : n < 1e9 ? 9 : 10;
	for (let p = pos + digits - 1; p >= pos; p--) {
		const q = (n / 10) | 0;
		buf[p] = 48 + n - q * 10;
		n = q;
	}
	return pos + digits;
}

async function forEachLimited(items, limit, fn) {
	let next = 0;
	const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (next < items.length) await fn(items[next++]);
	});
	await Promise.all(workers);
}

// ---------------------------------------------------------------------------
// Mars night sky

// IAU 2015 direction of Mars' north pole (ICRF) and Mars' orbit plane (J2000 ecliptic).
const MARS_POLE_RA = 317.68143;
const MARS_POLE_DEC = 52.8865;
const MARS_ORBIT_INCLINATION = 1.84969;
const MARS_ORBIT_ASCENDING_NODE = 49.55954;
const J2000_OBLIQUITY = 23.43928;
// The game has no calendar, so the sky is drawn at Mars' northern spring equinox (solar
// longitude 0), when the Sun sits at Mars' vernal equinox.
const SKY_SOLAR_LONGITUDE = 0;
// Include stars slightly below the horizon, as cmd/server/mars_sky.go does.
const MIN_STAR_ALTITUDE = -10;
const DEFAULT_STAR_LIMIT = 500;
const DEG = Math.PI / 180;

// Per star, in Mars' equatorial frame: right ascension (radians), sin and cos of declination.
let marsStarPositions;
let sunMarsRightAscension;

function unitVector(raDeg, decDeg) {
	const ra = raDeg * DEG;
	const dec = decDeg * DEG;
	return [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

function normalize(v) {
	const length = Math.hypot(v[0], v[1], v[2]);
	return [v[0] / length, v[1] / length, v[2] / length];
}

// Axes of Mars' equatorial frame expressed in ICRF: z is Mars' north pole, x its vernal equinox.
function marsEquatorialFrame() {
	const z = unitVector(MARS_POLE_RA, MARS_POLE_DEC);
	const i = MARS_ORBIT_INCLINATION * DEG;
	const node = MARS_ORBIT_ASCENDING_NODE * DEG;
	const eps = J2000_OBLIQUITY * DEG;
	const eclipticNormal = [Math.sin(i) * Math.sin(node), -Math.sin(i) * Math.cos(node), Math.cos(i)];
	const orbitNormal = [
		eclipticNormal[0],
		eclipticNormal[1] * Math.cos(eps) - eclipticNormal[2] * Math.sin(eps),
		eclipticNormal[1] * Math.sin(eps) + eclipticNormal[2] * Math.cos(eps),
	];
	// The vernal equinox is where Mars' orbit plane crosses its equator heading north.
	const x = normalize(cross(z, orbitNormal));
	return { x, y: cross(z, x), z, obliquity: Math.acos(dot(z, orbitNormal)) };
}

function loadMarsSky() {
	if (marsStarPositions) return;
	const { x, y, z, obliquity } = marsEquatorialFrame();
	const count = BRIGHT_STARS.length / 5;
	marsStarPositions = new Float64Array(count * 3);
	for (let i = 0; i < count; i++) {
		const star = unitVector(BRIGHT_STARS[i * 5 + 1], BRIGHT_STARS[i * 5 + 2]);
		const sinDec = dot(star, z);
		marsStarPositions[i * 3] = Math.atan2(dot(star, y), dot(star, x));
		marsStarPositions[i * 3 + 1] = sinDec;
		marsStarPositions[i * 3 + 2] = Math.sqrt(Math.max(0, 1 - sinDec * sinDec));
	}
	const ls = SKY_SOLAR_LONGITUDE * DEG;
	sunMarsRightAscension = Math.atan2(Math.sin(ls) * Math.cos(obliquity), Math.cos(ls));
}

const round3 = (value) => Math.round(value * 1000) / 1000;

// Brightest stars above MIN_STAR_ALTITUDE for an observer at `lat` at local solar time
// `timeHours` (12 = noon), with azimuth measured clockwise from north.
function visibleStars(lat, timeHours, limit) {
	loadMarsSky();
	const siderealAngle = sunMarsRightAscension + (timeHours - 12) * 15 * DEG;
	const sinLat = Math.sin(lat * DEG);
	const cosLat = Math.cos(lat * DEG);
	const minSinAltitude = Math.sin(MIN_STAR_ALTITUDE * DEG);
	const count = BRIGHT_STARS.length / 5;
	const stars = [];
	for (let i = 0; i < count && stars.length < limit; i++) {
		const hourAngle = siderealAngle - marsStarPositions[i * 3];
		const sinDec = marsStarPositions[i * 3 + 1];
		const cosDec = marsStarPositions[i * 3 + 2];
		const cosHourAngle = Math.cos(hourAngle);
		const sinAltitude = sinDec * sinLat + cosDec * cosLat * cosHourAngle;
		if (sinAltitude < minSinAltitude) continue;
		const east = -cosDec * Math.sin(hourAngle);
		const north = sinDec * cosLat - cosDec * sinLat * cosHourAngle;
		const azimuth = Math.atan2(east, north) / DEG;
		stars.push({
			hip: BRIGHT_STARS[i * 5],
			magnitude: BRIGHT_STARS[i * 5 + 3],
			altitude: round3(Math.asin(sinAltitude) / DEG),
			azimuth: round3(azimuth < 0 ? azimuth + 360 : azimuth),
			color: STAR_COLORS[BRIGHT_STARS[i * 5 + 4]],
		});
	}
	return stars;
}

function handleMarsSky(request, env, url) {
	if (request.method === "OPTIONS") return preflight(env);

	const params = url.searchParams;
	if (!params.get("lat") || !params.get("lon")) return textError("Missing lat/lon parameters", 400, env);
	const lat = parseFloatStrict(params.get("lat"));
	const lon = parseFloatStrict(params.get("lon"));
	if (Number.isNaN(lat) || lat < -90 || lat > 90) return textError("Invalid latitude value", 400, env);
	if (Number.isNaN(lon)) return textError("Invalid longitude value", 400, env);
	const time = parseFloatStrict(params.get("time"));
	const timeHours = Number.isNaN(time) ? 12 : time;
	const limitValue = parseIntStrict(params.get("limit"));
	const limit = limitValue > 0 ? limitValue : DEFAULT_STAR_LIMIT;

	return jsonResponse(
		env,
		{ marsLocation: { latitude: lat, longitude: lon, timeHours }, stars: visibleStars(lat, timeHours, limit) },
		{ "Cache-Control": SKY_CACHE_CONTROL },
	);
}

// ---------------------------------------------------------------------------
// Multiplayer

// Every player shares one room; the Durable Object holds the WebSocket connections.
function handleMultiplayer(request, env) {
	if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
		return textError("Expected a WebSocket upgrade", 426);
	}
	// Browsers always send Origin; only the game's own page may join the room.
	const origin = request.headers.get("Origin");
	const allowed = env.ALLOWED_ORIGIN || "*";
	if (origin && allowed !== "*" && origin !== allowed) return textError("Origin not allowed", 403);

	return env.MULTIPLAYER.get(env.MULTIPLAYER.idFromName("global")).fetch(request);
}

// ---------------------------------------------------------------------------
// Static assets from R2

async function handleAsset(request, env, path) {
	// R2 keys keep the "assets/" prefix, e.g. /assets/models/x.glb -> assets/models/x.glb.
	let key;
	try {
		key = decodeURIComponent(path.slice(1));
	} catch {
		return textError("404 page not found", 404);
	}

	const obj = await env.ASSETS_BUCKET.get(key, { onlyIf: request.headers });
	if (!obj) return textError("404 page not found", 404);

	const headers = new Headers();
	obj.writeHttpMetadata(headers);
	if (!headers.has("Content-Type")) {
		const type = ASSET_CONTENT_TYPES[key.split(".").pop().toLowerCase()];
		if (type) headers.set("Content-Type", type);
	}
	headers.set("ETag", obj.httpEtag);
	headers.set("Cache-Control", ASSET_CACHE_CONTROL);

	// With onlyIf, R2 returns metadata without a body when the client's copy is current.
	if (!("body" in obj)) return new Response(null, { status: 304, headers });
	if (request.method === "HEAD") return new Response(null, { headers });
	return new Response(obj.body, { headers });
}
