import { watch } from "node:fs";
import { join, dirname, extname, relative } from "node:path";

const TS_DIR = join(import.meta.dir, "ts");
const JS_DIR = join(import.meta.dir, "js");

async function compileFile(filePath: string) {
  if (extname(filePath) !== ".ts") return;

  const relPath = relative(TS_DIR, filePath);
  const targetPath = join(JS_DIR, relPath.replace(/\.ts$/, ".js"));

  try {
    const result = await Bun.build({
      entrypoints: [filePath],
      outdir: dirname(targetPath),
      naming: "[name].[ext]",
      target: "browser",
    });

    if (result.success) {
      console.log(`已编译：${filePath} -> ${targetPath}`);
    } else {
      console.error(`${filePath} 编译失败：`, result.logs);
    }
  } catch (err) {
    console.error(`编译 ${filePath} 时发生错误：`, err);
  }
}

watch(TS_DIR, { recursive: true }, async (event, filename) => {
  if (filename && filename.endsWith(".ts")) {
    const fullPath = join(TS_DIR, filename);
    setTimeout(() => compileFile(fullPath), 100);
  }
});

console.log(`前端 builder 已启动`);