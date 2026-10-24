/**
 * dsh-Ycp · 大肥鱼（能力层）—— 内置的演示工具。
 *
 * P09 只验证注册表本身能不能把能力挂上去、面板能不能看到、调用能不能通。
 * 真的手（浏览器 / 桌面 / 脚本）在 P11–P13，不在这里。
 */
export function installBuiltins(registry) {
  registry.registerTool({
    id: 'demo.echo',
    description: '把你说的话原样返回（演示用，不碰任何外部资源）',
    schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '要说的话' },
      },
      required: ['text'],
    },
    run: ({ text }) => ({ text: String(text) }),
  })

  registry.registerTool({
    id: 'demo.time',
    description: '返回现在的本地时间（演示用）',
    schema: { type: 'object', properties: {}, required: [] },
    run: () => {
      const now = new Date()
      return { iso: now.toISOString(), local: now.toLocaleString('zh-CN') }
    },
  })

  registry.registerAppearance({
    id: 'placeholder',
    name: '占位形象',
    description: 'P09 只验证注册流程；真正的形象在 P15 挂上来',
  })
}
