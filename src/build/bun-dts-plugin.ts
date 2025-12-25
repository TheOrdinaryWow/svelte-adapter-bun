import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { BunPlugin } from "bun";
import { isolatedDeclaration } from "oxc-transform";

export default function getDtsBunPlugin(): BunPlugin {
  const wroteTrack = new Set<string>();

  return {
    name: "oxc-transform-dts",
    async setup(builder) {
      if (builder.config.root && builder.config.outdir) {
        const rootPath = pathToFileURL(builder.config.root).pathname;
        const outPath = pathToFileURL(builder.config.outdir).pathname;

        builder.onStart(() => wroteTrack.clear());

        builder.onStart(async () => {
          const typeFilePath = `${rootPath}/types`;
          if (!existsSync(typeFilePath)) {
            return;
          }

          const typeFileOutPath = `${outPath}/types`;

          const entries = await readdir(typeFilePath, { withFileTypes: true });

          await Promise.all(
            entries.map(async (entry) => {
              const srcPath = path.join(typeFilePath, entry.name);
              const destPath = path.join(typeFileOutPath, entry.name);

              if (entry.isDirectory()) {
                await mkdir(destPath, { recursive: true });
              } else {
                let fileName = entry.name;
                if (fileName.endsWith(".ts") && !fileName.endsWith(".d.ts")) {
                  fileName = fileName.replace(/\.ts$/, ".d.ts");
                }
                const destFilePath = path.join(typeFileOutPath, fileName);

                let content = await readFile(srcPath, "utf-8");

                content = content.replace(
                  /\bexport\s+(type|interface|const|let|var|function|class|enum)\b/g,
                  "export declare $1",
                );
                // content = content.replace(/\bexport\s+default\b/g, "export declare");

                await mkdir(path.dirname(destFilePath), { recursive: true });
                await writeFile(destFilePath, content, "utf-8");
              }
            }),
          );
        });

        builder.onLoad({ filter: /\.ts$/ }, async (args) => {
          if (args.path.startsWith(rootPath) && !wroteTrack.has(args.path)) {
            wroteTrack.add(args.path);

            const result = isolatedDeclaration(args.path, await Bun.file(args.path).text());
            const code = result?.code;

            if (code) {
              const fixedCode = code.replace(/import\s+.+\s+from\s+['"]([^'"]+)['"]/g, (match, importPath) =>
                importPath.startsWith(".") && !importPath.endsWith(".ts") && !importPath.endsWith(".d.ts")
                  ? match.replace(importPath, `${importPath}.d.ts`)
                  : match,
              );

              const dest = args.path.replace(new RegExp(`^${rootPath}`), outPath).replace(/\.ts$/, ".d.ts");
              await Bun.write(dest, fixedCode);
            }
          }

          return undefined;
        });
      }
    },
  };
}
