import { registerHooks } from "node:module";

/*
 * Node 运行测试时为 Vite 使用的相对 TS 导入补扩展名。
 *
 * src 下的相对导入一律不写扩展名（`./cnEnrichment`），Vite 能解析，裸 Node
 * 的 ESM 解析器不能。测试里直接 import 某个 .ts 时，它往下牵出的那一串相对
 * 导入都会 ERR_MODULE_NOT_FOUND。这里临时挂一个 resolve 钩子，把「相对路径
 * 且没有扩展名」的说明符补成 .ts，加载完立刻摘掉，不影响别的测试文件。
 */
export async function importTs(specifier) {
  const loader = registerHooks({
    resolve(spec, context, nextResolve) {
      if (spec.startsWith(".") && context.parentURL?.includes("/src/") && !/\.[a-z]+$/i.test(spec)) {
        return nextResolve(`${spec}.ts`, context);
      }
      return nextResolve(spec, context);
    },
  });
  try {
    return await import(specifier);
  } finally {
    loader.deregister();
  }
}
