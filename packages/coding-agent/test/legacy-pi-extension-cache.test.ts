import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import * as path from "node:path";
import { TempDir } from "@oh-my-pi/pi-utils";

interface CacheProbeResult {
	cachePath: string;
	rewritten: string;
}

interface CacheRow {
	cache_key: string;
	references_json: string;
}

interface CachedReference {
	kind: "import" | "require";
	specifier: string;
	start: number;
	end: number;
}

const probePath = path.resolve(import.meta.dir, "fixtures", "legacy-pi-extension-cache-probe.ts");
const source = 'import value from "tracked-dep";';

async function runProbe(home: string, importerPath: string): Promise<CacheProbeResult> {
	const env: Record<string, string | undefined> = {
		...process.env,
		HOME: home,
		USERPROFILE: home,
		XDG_CACHE_HOME: path.join(home, "cache"),
	};
	for (const key of ["PI_CODING_AGENT_DIR", "OMP_PROFILE", "PI_PROFILE", "PI_CONFIG_DIR"]) {
		delete env[key];
	}
	const proc = Bun.spawn([process.execPath, probePath, source, importerPath], {
		cwd: path.resolve(import.meta.dir, ".."),
		env,
		stderr: "pipe",
		stdout: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	expect(exitCode, stderr).toBe(0);
	return JSON.parse(stdout) as CacheProbeResult;
}

async function writePackage(root: string, name: string): Promise<void> {
	await Bun.write(
		path.join(root, "node_modules", name, "package.json"),
		JSON.stringify({ name, version: "1.0.0", type: "module", exports: "./index.js" }),
	);
	await Bun.write(path.join(root, "node_modules", name, "index.js"), `export default ${JSON.stringify(name)};\n`);
}

describe("legacy Pi extension parse cache", () => {
	test("persists and reuses specifier analysis across processes", async () => {
		using tempDir = TempDir.createSync("@omp-legacy-extension-cache-");
		const extensionRoot = tempDir.join("extension");
		const importerPath = path.join(extensionRoot, "index.ts");
		const home = tempDir.join("home");
		await Bun.write(importerPath, source);
		await writePackage(extensionRoot, "tracked-dep");
		await writePackage(extensionRoot, "cached-dep");

		const first = await runProbe(home, importerPath);
		expect(first.rewritten.replaceAll("\\", "/")).toContain("/tracked-dep/index.js");

		const db = new Database(first.cachePath);
		try {
			const row = db
				.query<CacheRow, []>('SELECT cache_key, "references" AS references_json FROM extension_parse_cache LIMIT 1')
				.get();
			expect(row).toBeDefined();
			const references = JSON.parse(row!.references_json) as CachedReference[];
			expect(references).toHaveLength(1);
			references[0] = { ...references[0]!, specifier: "cached-dep" };
			db.run('UPDATE extension_parse_cache SET "references" = ? WHERE cache_key = ?', [
				JSON.stringify(references),
				row!.cache_key,
			]);
		} finally {
			db.close();
		}

		const second = await runProbe(home, importerPath);
		expect(second.rewritten.replaceAll("\\", "/")).toContain("/cached-dep/index.js");
	}, 30_000);
});
