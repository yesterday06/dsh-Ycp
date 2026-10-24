/**
 * Cordis 服务的可选读取。
 *
 * 插件没有在 `static inject` 里声明某个服务时，直接 `ctx.tokenMeter` 会抛
 * “cannot get property ... without inject”，而不是给 undefined。所有可选能力
 * 都必须走这里，用 `ctx.get(name)` 拿。
 */
export function svc(ctx, name) {
  try {
    return ctx.get?.(name)
  } catch {
    return undefined
  }
}
