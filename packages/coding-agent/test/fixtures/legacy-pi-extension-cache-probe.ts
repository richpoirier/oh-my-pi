import { getLegacyPiExtensionCacheDbPath } from "@oh-my-pi/pi-utils";
import { __rewriteLegacyExtensionSourceForTests } from "../../src/extensibility/plugins/legacy-pi-compat";

const [source, importerPath] = process.argv.slice(2);
if (source === undefined || importerPath === undefined) {
	throw new Error("expected source and importer path arguments");
}

const rewritten = await __rewriteLegacyExtensionSourceForTests(source, importerPath);
await Promise.resolve();

process.stdout.write(
	JSON.stringify({
		cachePath: getLegacyPiExtensionCacheDbPath(),
		rewritten,
	}),
);
