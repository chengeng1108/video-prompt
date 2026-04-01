import { defineEventHandler, readBody, createError, getRequestIP, setResponseHeaders } from 'h3'

// ============================================================
// 黑客模式：所有逻辑塞一个文件，能跑就行
// ============================================================

// 穷人版内存限流器 —— 不需要 Redis/KV，Serverless 冷启动会重置，够用了
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT = 10        // 每个 IP 最多 10 次
const RATE_WINDOW = 86400000 // 24 小时窗口（毫秒）

function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const record = rateLimitMap.get(ip)
  if (!record || now > record.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW })
    return true
  }
  if (record.count >= RATE_LIMIT) return false
  record.count++
  return true
}

// 无情 System Prompt —— 专治“复读机”和“浅层描述”
const SYSTEM_PROMPT = `你是一位“电影级短视频分镜导演 + 视频生成模型（Kling/Jimeng）提示词工程师”。
用户通常只会给一句粗略想法，你必须执行“加法创作”：在不偏离用户意图的前提下，自动补全人物细节、动作细节、环境细节、光影细节、镜头语言和情绪推进，产出可直接落地的视频分镜。

【绝对硬规则】
1. 全部输出必须是纯中文，不允许英文翻译版，不允许中英混写。
2. 每次输出必须是 3-5 个镜头（为了保持短视频节奏紧凑），且镜头间有明显递进（起-承-转-合或冲突-反应-推进-收束）。
3. 严禁“复读机”：相邻镜头不能重复同一动作、同一机位、同一句式。每个镜头至少新增一个关键信息（动作变化/景别变化/光线变化/情绪变化/道具交互变化）。
4. 每个镜头都必须有“明确且简单的主体动作 + 明确的环境或道具交互”。
5. 动作描述必须可拍摄、可执行，拒绝空话。不要写“两人相视一笑”，要写成“男主微微抬头，嘴角上扬，眼神看向女主”。
6. 最终供用户复制的字段必须是针对视频模型的：必须是一整段中文单行文本，强调画面连贯性和物理运动。
7. 提示词单行文本必须同时包含：主体描述 + 具体动作 + 物理交互 + 环境光影 + 色彩气质 + 镜头语言 + 画质质感 + 情绪关键词。
8. 提示词字段禁止换行、禁止列表、禁止解释性前后缀（例如“可用于生成”这类废话）。

【动作与物理交互规则（重点）】
- 每镜头只写 1 个核心动作，动作应短促明确（抬头/转身/伸手/松手/推门/停步/坐下/回头等）。
- 必须绑定一个可见交互对象（扶手/门把/耳机线/雨伞/玻璃窗/桌面水杯/衣角/手机/风/雨/烟雾/光束等）。
- 动作结果要能在画面中看到（例如“耳机线滑落到肩侧”“雨滴沿窗面下滑”）。

【镜头深度规则】
- 每个“画面描述”至少覆盖：场景、人物状态、动作、交互、光影、色彩。
- 每个镜头标注“镜头运动”时，要与剧情节奏匹配，避免全程固定机位。
- 时长建议使用秒数，单镜头 3-5 秒。

【输出格式（必须严格遵循，不要输出任何开场白或结束语）】
### 镜头 1
- **画面描述**：[中文，具体可拍的细节]
- **镜头运动**：[推/拉/摇/移/跟/固定/手持微晃等]
- **时长**：[X秒]
- **💡 视频提示词**：[中文单行长句，专为视频模型定制，融合以上所有元素，极具画面感，可直接复制粘贴]

### 镜头 2
...

【质量自检（你在心里执行，绝对不要输出到文本中）】
- 我是否避免了重复句式和重复动作？
- 每个镜头是否都出现了“动作 + 交互”？
- 💡 视频提示词是否是中文单行并包含必备元素？`

export default defineEventHandler(async (event) => {
  // 只接受 POST
  if (event.method !== 'POST') {
    throw createError({ statusCode: 405, statusMessage: 'Method Not Allowed' })
  }

  // 读取用户输入
  const body = await readBody(event)
  const userPrompt = body?.prompt?.trim()
  const selectedModel: string = body?.model || 'claude-sonnet-4-6'
  if (!userPrompt) {
    throw createError({ statusCode: 400, statusMessage: '请输入你的视频创意' })
  }
  if (userPrompt.length > 2000) {
    throw createError({ statusCode: 400, statusMessage: '输入太长了，请控制在2000字以内' })
  }

  // 限流
  const ip = getRequestIP(event, { xForwardedFor: true }) || 'unknown'
  if (!checkRateLimit(ip)) {
    throw createError({ statusCode: 429, statusMessage: '今天的使用次数已用完，请明天再来' })
  }

  const isCodexModel = selectedModel.startsWith('gpt-')

  let response: Response

  if (isCodexModel) {
    // ---- Codex 路径：OpenAI Responses API ----
    const codexApiKey = process.env.CODEX_API_KEY || ''
    if (!codexApiKey) {
      throw createError({ statusCode: 500, statusMessage: '服务配置错误：缺少 Codex API Key' })
    }
    response = await fetch('https://code.rayinai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${codexApiKey}`,
      },
      body: JSON.stringify({
        model: selectedModel,
        instructions: SYSTEM_PROMPT,
        input: userPrompt,
        stream: true,
      }),
    })
  } else {
    // ---- Claude 路径 ----
    const apiKey = process.env.CLAUDE_API_KEY || ''
    const baseUrl = process.env.CLAUDE_BASE_URL || 'https://api.anthropic.com'
    if (!apiKey) {
      throw createError({ statusCode: 500, statusMessage: '服务配置错误：缺少 API Key' })
    }
    response = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: selectedModel,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
        stream: true,
        max_tokens: 4096,
      }),
    })
  }

  if (!response.ok) {
    const errorText = await response.text()
    console.error('API error:', response.status, errorText)
    throw createError({
      statusCode: 502,
      statusMessage: '大模型服务暂时不可用，请稍后重试',
    })
  }

  // 统一转为前端期望的 OpenAI 兼容格式
  setResponseHeaders(event, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  })

  const reader = response.body!.getReader()
  const decoder = new TextDecoder()

  return new ReadableStream({
    async pull(controller) {
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
          controller.close()
          return
        }
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data: ')) continue
          const data = trimmed.slice(6)
          if (data === '[DONE]') continue
          try {
            const parsed = JSON.parse(data)
            let text: string | undefined
            if (isCodexModel) {
              // Responses API: response.output_text.delta 事件
              if (parsed.type === 'response.output_text.delta' && parsed.delta) {
                text = parsed.delta
              }
            } else {
              // Claude API: content_block_delta 事件
              if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
                text = parsed.delta.text
              }
            }
            if (text) {
              const chunk = JSON.stringify({ choices: [{ delta: { content: text } }] })
              controller.enqueue(new TextEncoder().encode(`data: ${chunk}\n\n`))
            }
          } catch { /* skip malformed */ }
        }
      }
    }
  })
})
