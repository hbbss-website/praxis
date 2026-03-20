import { Glob } from "bun";
import { join } from "path";

const TS_DIR = join(import.meta.dir, "ts");
const JS_DIR = join(import.meta.dir, "js");

const glob = new Bun.Glob("**/*.ts");

const entrypoints = [...glob.scanSync({ cwd: TS_DIR })].map(
  (file) => join(TS_DIR, file)
);

console.log(`找到 ${entrypoints.length} 个文件，开始构建...`);

const result = await Bun.build({
  entrypoints: entrypoints,
  root: TS_DIR,
  outdir: JS_DIR,
  target: "browser",
  format: "esm",
  minify: true,
});

if (!result.success) {
  console.error("❌ 前端构建失败:");
  for (const message of result.logs) {
    console.error(message);
  }
} else {
  console.log("✅ 前端构建成功");
}