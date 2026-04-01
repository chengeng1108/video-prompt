<script setup lang="ts">
import { marked } from 'marked'

// ============================================================
// 黑客模式：所有逻辑塞一个文件，能跑就行
// ============================================================

const prompt = ref('')
const rawMarkdown = ref('')
const isStreaming = ref(false)
const isDone = ref(false)
const errorMessage = ref('')
const outputRef = ref<HTMLElement | null>(null)

const selectedModel = ref('gpt-5.3-codex')
const MODELS = [
  { id: 'gpt-5.1-codex-mini', label: 'GPT Mini', tag: '经济' },
  { id: 'gpt-5.3-codex', label: 'GPT 5.3', tag: '均衡' },
  { id: 'gpt-5.4', label: 'GPT-5.4', tag: '旗舰' },
]

// 实时 Markdown → HTML
const renderedHtml = computed(() => {
  if (!rawMarkdown.value) return ''
  return marked.parse(rawMarkdown.value, { async: false }) as string
})

// 字符计数
const charCount = computed(() => prompt.value.length)

// ---- 核心：流式请求 + SSE 解析 ----
async function generate() {
  if (!prompt.value.trim() || isStreaming.value) return

  rawMarkdown.value = ''
  errorMessage.value = ''
  isStreaming.value = true
  isDone.value = false

  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: prompt.value.trim(), model: selectedModel.value }),
    })

    if (!res.ok) {
      const text = await res.text()
      try {
        const err = JSON.parse(text)
        errorMessage.value = err.statusMessage || err.message || `错误 ${res.status}`
      } catch {
        errorMessage.value = text || `请求失败 (${res.status})`
      }
      isStreaming.value = false
      return
    }

    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data: ')) continue
        const data = trimmed.slice(6)
        if (data === '[DONE]') {
          isDone.value = true
          isStreaming.value = false
          await nextTick()
          injectCopyButtons()
          return
        }
        try {
          const parsed = JSON.parse(data)
          const content = parsed.choices?.[0]?.delta?.content
          if (content) {
            rawMarkdown.value += content
            // 自动滚动到底部
            await nextTick()
            if (outputRef.value) {
              outputRef.value.scrollTop = outputRef.value.scrollHeight
            }
          }
        } catch { /* malformed chunk, skip */ }
      }
    }

    // 流结束但没收到 [DONE]
    isDone.value = true
    isStreaming.value = false
    await nextTick()
    injectCopyButtons()
  } catch (err: any) {
    errorMessage.value = err.message || '网络错误，请检查连接'
    isStreaming.value = false
  }
}

// ---- 提取每个镜头的 AI 生图提示词 ----
function extractShotPrompts(): Map<number, string> {
  const map = new Map<number, string>()
  const shotRegex = /## 镜头\s*(\d+)([\s\S]*?)(?=## 镜头|\s*$)/g
  let match: RegExpExecArray | null
  while ((match = shotRegex.exec(rawMarkdown.value)) !== null) {
    const shotNum = parseInt(match[1])
    const block = match[2]
    const promptMatch = block.match(/\*\*AI 生图提示词[：:]\*\*\s*(.+?)(?:\n|$)/)
    if (promptMatch) {
      map.set(shotNum, promptMatch[1].trim())
    }
  }
  return map
}

// ---- DOM 注入复制按钮 ----
function injectCopyButtons() {
  const container = outputRef.value
  if (!container) return

  const prompts = extractShotPrompts()
  const headings = container.querySelectorAll('h2')

  headings.forEach((h2) => {
    const text = h2.textContent || ''
    const numMatch = text.match(/镜头\s*(\d+)/)
    if (!numMatch) return

    const shotNum = parseInt(numMatch[1])
    const promptText = prompts.get(shotNum)
    if (!promptText) return

    // 避免重复注入
    if (h2.querySelector('.copy-btn')) return

    const btn = document.createElement('button')
    btn.className = 'copy-btn'
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg> 复制提示词`
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(promptText)
      } catch {
        fallbackCopy(promptText)
      }
      btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> 已复制`
      btn.classList.add('copied')
      setTimeout(() => {
        btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg> 复制提示词`
        btn.classList.remove('copied')
      }, 2000)
    })

    h2.style.position = 'relative'
    h2.appendChild(btn)
  })
}

function fallbackCopy(text: string) {
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.cssText = 'position:fixed;opacity:0'
  document.body.appendChild(ta)
  ta.select()
  document.execCommand('copy')
  document.body.removeChild(ta)
}
</script>

<template>
  <div class="scene">
    <!-- 背景装饰线 -->
    <div class="grid-lines" aria-hidden="true">
      <div v-for="i in 6" :key="i" class="h-line" :style="{ top: `${i * 16}%` }" />
      <div v-for="i in 4" :key="`v${i}`" class="v-line" :style="{ left: `${i * 25}%` }" />
    </div>

    <div class="stage">
      <!-- 标题 -->
      <header class="masthead">
        <div class="logo-mark">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <rect x="2" y="6" width="28" height="20" rx="3" stroke="currentColor" stroke-width="1.5"/>
            <circle cx="10" cy="16" r="3" stroke="currentColor" stroke-width="1.5"/>
            <path d="M20 12l6 4-6 4V12z" fill="currentColor" opacity="0.6"/>
          </svg>
        </div>
        <h1>分镜拆解机</h1>
        <p class="tagline">输入创意，生成专业短视频分镜脚本</p>
      </header>

      <!-- 输入区 -->
      <div class="input-block">
        <!-- 模型选择 -->
        <div class="model-selector">
          <button
            v-for="m in MODELS"
            :key="m.id"
            class="model-btn"
            :class="{ active: selectedModel === m.id }"
            :disabled="isStreaming"
            @click="selectedModel = m.id"
          >
            {{ m.label }}<span v-if="m.tag" class="model-tag">{{ m.tag }}</span>
          </button>
        </div>
        <div class="textarea-wrap">
          <textarea
            v-model="prompt"
            placeholder="描述你的短视频想法 ——&#10;&#10;例如：清晨的咖啡馆，一个女生翻开旧相册，画面切到十年前的夏天，她在海边奔跑，裙摆被风吹起..."
            :disabled="isStreaming"
            rows="5"
            maxlength="2000"
            @keydown.meta.enter="generate"
            @keydown.ctrl.enter="generate"
          />
          <span class="char-count" :class="{ warn: charCount > 1800 }">{{ charCount }}/2000</span>
        </div>
        <button
          class="gen-btn"
          :disabled="isStreaming || !prompt.trim()"
          @click="generate"
        >
          <template v-if="isStreaming">
            <span class="spinner" />
            生成中
          </template>
          <template v-else>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            生成分镜
          </template>
        </button>
        <p class="shortcut-hint">Cmd+Enter / Ctrl+Enter 快捷发送</p>
      </div>

      <!-- 错误 -->
      <Transition name="fade">
        <div v-if="errorMessage" class="error-bar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
          {{ errorMessage }}
        </div>
      </Transition>

      <!-- 输出区 -->
      <Transition name="slide-up">
        <div v-if="rawMarkdown" class="output-block">
          <div class="output-bar">
            <span class="output-label">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              分镜脚本
            </span>
            <span v-if="isDone" class="done-badge">生成完毕</span>
          </div>
          <div ref="outputRef" class="output-body markdown-body" v-html="renderedHtml" />
        </div>
      </Transition>

      <!-- 流式指示器 -->
      <Transition name="fade">
        <div v-if="isStreaming" class="stream-indicator">
          <span class="pulse-ring" />
          <span>AI 正在拆解你的创意...</span>
        </div>
      </Transition>
    </div>
  </div>
</template>

<style>
/* ── 全局重置 ── */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { background: #060608; color: #c8ccd0; }
body { margin: 0; -webkit-font-smoothing: antialiased; }

@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;700&family=JetBrains+Mono:wght@400;500&display=swap');
</style>

<style scoped>
/* ── 设计 Token ── */
:root {
  --bg: #060608;
  --surface: #0d0d11;
  --surface-2: #13131a;
  --border: #1e1e28;
  --border-focus: #2d4a5a;
  --text: #c8ccd0;
  --text-dim: #5a5e66;
  --accent: #3dd8c5;
  --accent-glow: rgba(61, 216, 197, 0.12);
  --accent-dim: #1a3a35;
  --red: #f06060;
  --red-bg: #1a0808;
  --green: #5ddf70;
  --font-body: 'Noto Sans SC', 'PingFang SC', -apple-system, sans-serif;
  --font-mono: 'JetBrains Mono', 'Menlo', monospace;
}

/* ── 场景 ── */
.scene {
  position: relative;
  min-height: 100vh;
  background: var(--bg);
  overflow: hidden;
  font-family: var(--font-body);
}

/* 背景网格线 */
.grid-lines { position: fixed; inset: 0; pointer-events: none; z-index: 0; }
.h-line, .v-line { position: absolute; background: rgba(255,255,255,0.015); }
.h-line { left: 0; right: 0; height: 1px; }
.v-line { top: 0; bottom: 0; width: 1px; }

/* ── 舞台 ── */
.stage {
  position: relative;
  z-index: 1;
  max-width: 740px;
  margin: 0 auto;
  padding: 4rem 1.5rem 6rem;
}

/* ── 标题区 ── */
.masthead {
  text-align: center;
  margin-bottom: 3rem;
}
.logo-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: 14px;
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--accent);
  margin-bottom: 1.25rem;
}
.masthead h1 {
  font-size: 1.75rem;
  font-weight: 700;
  color: #fff;
  letter-spacing: 0.02em;
  margin-bottom: 0.5rem;
}
.tagline {
  font-size: 0.9rem;
  color: var(--text-dim);
  font-weight: 400;
}

/* ── 模型选择器 ── */
.model-selector {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
  margin-bottom: 0.75rem;
}
.model-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.3rem 0.75rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text-dim);
  font-size: 0.78rem;
  font-family: var(--font-mono);
  cursor: pointer;
  transition: all 0.15s;
}
.model-btn:hover:not(:disabled) {
  border-color: var(--border-focus);
  color: var(--text);
}
.model-btn.active {
  background: var(--accent-dim);
  border-color: rgba(61, 216, 197, 0.35);
  color: var(--accent);
}
.model-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.model-tag {
  font-size: 0.65rem;
  padding: 0.1rem 0.3rem;
  background: rgba(255,255,255,0.06);
  border-radius: 3px;
  line-height: 1.4;
}
.model-btn.active .model-tag {
  background: rgba(61, 216, 197, 0.15);
}

/* ── 输入区 ── */
.input-block {
  margin-bottom: 1.5rem;
}
.textarea-wrap {
  position: relative;
  margin-bottom: 0.75rem;
}
textarea {
  display: block;
  width: 100%;
  min-height: 140px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  color: var(--text);
  padding: 1rem 1.15rem;
  padding-bottom: 2rem;
  font-size: 0.95rem;
  font-family: var(--font-body);
  line-height: 1.7;
  resize: vertical;
  transition: border-color 0.2s, box-shadow 0.2s;
}
textarea::placeholder { color: var(--text-dim); opacity: 0.6; }
textarea:focus {
  outline: none;
  border-color: var(--border-focus);
  box-shadow: 0 0 0 3px var(--accent-glow);
}
textarea:disabled { opacity: 0.4; cursor: not-allowed; }
.char-count {
  position: absolute;
  right: 12px;
  bottom: 8px;
  font-size: 0.72rem;
  font-family: var(--font-mono);
  color: var(--text-dim);
  pointer-events: none;
}
.char-count.warn { color: var(--red); }

/* 生成按钮 */
.gen-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.65rem 1.6rem;
  background: var(--accent);
  color: #060608;
  border: none;
  border-radius: 8px;
  font-size: 0.92rem;
  font-weight: 600;
  font-family: var(--font-body);
  cursor: pointer;
  transition: opacity 0.15s, transform 0.1s;
}
.gen-btn:hover:not(:disabled) { opacity: 0.88; transform: translateY(-1px); }
.gen-btn:active:not(:disabled) { transform: translateY(0); }
.gen-btn:disabled { opacity: 0.3; cursor: not-allowed; }

.shortcut-hint {
  margin-top: 0.5rem;
  font-size: 0.75rem;
  color: var(--text-dim);
  font-family: var(--font-mono);
}

/* 按钮 spinner */
.spinner {
  width: 16px; height: 16px;
  border: 2px solid rgba(6,6,8,0.25);
  border-top-color: #060608;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* ── 错误 ── */
.error-bar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.7rem 1rem;
  background: var(--red-bg);
  border: 1px solid rgba(240,96,96,0.2);
  border-radius: 8px;
  color: var(--red);
  font-size: 0.88rem;
  margin-bottom: 1.5rem;
}

/* ── 输出区 ── */
.output-block {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
  margin-bottom: 1rem;
}
.output-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.65rem 1.15rem;
  background: var(--surface-2);
  border-bottom: 1px solid var(--border);
}
.output-label {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.82rem;
  font-weight: 500;
  color: var(--text-dim);
}
.done-badge {
  font-size: 0.72rem;
  font-family: var(--font-mono);
  padding: 0.2rem 0.55rem;
  background: rgba(93,223,112,0.1);
  color: var(--green);
  border-radius: 4px;
  border: 1px solid rgba(93,223,112,0.15);
}

.output-body {
  padding: 1.5rem 1.25rem;
  max-height: 70vh;
  overflow-y: auto;
  line-height: 1.85;
  scroll-behavior: smooth;
}

/* 自定义滚动条 */
.output-body::-webkit-scrollbar { width: 5px; }
.output-body::-webkit-scrollbar-track { background: transparent; }
.output-body::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }

/* ── Markdown 内容样式（:deep 穿透 v-html）── */
.markdown-body :deep(h2) {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.5rem;
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--accent);
  margin-top: 2.2rem;
  margin-bottom: 0.6rem;
  padding-bottom: 0.55rem;
  border-bottom: 1px solid var(--border);
}
.markdown-body :deep(h2:first-child) { margin-top: 0; }

.markdown-body :deep(ul) {
  list-style: none;
  padding: 0;
  margin: 0.4rem 0 1.2rem;
}
.markdown-body :deep(li) {
  position: relative;
  padding-left: 1rem;
  margin: 0.35rem 0;
  font-size: 0.92rem;
}
.markdown-body :deep(li)::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0.65em;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--text-dim);
}
.markdown-body :deep(strong) {
  color: #e2e5e9;
  font-weight: 600;
}
.markdown-body :deep(p) {
  margin: 0.4rem 0;
}

/* ── 注入的复制按钮 ── */
.markdown-body :deep(.copy-btn) {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.22rem 0.6rem;
  background: var(--accent-dim);
  border: 1px solid rgba(61,216,197,0.2);
  border-radius: 5px;
  color: var(--accent);
  font-size: 0.72rem;
  font-family: var(--font-body);
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}
.markdown-body :deep(.copy-btn:hover) {
  background: rgba(61,216,197,0.15);
  border-color: rgba(61,216,197,0.35);
}
.markdown-body :deep(.copy-btn.copied) {
  background: rgba(93,223,112,0.1);
  border-color: rgba(93,223,112,0.2);
  color: var(--green);
}
.markdown-body :deep(.copy-btn svg) {
  flex-shrink: 0;
}

/* ── 流式指示器 ── */
.stream-indicator {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.65rem 0;
  font-size: 0.82rem;
  color: var(--text-dim);
  font-family: var(--font-mono);
}
.pulse-ring {
  width: 8px; height: 8px;
  background: var(--accent);
  border-radius: 50%;
  animation: pulse 1.2s ease-in-out infinite;
  box-shadow: 0 0 6px var(--accent);
}
@keyframes pulse {
  0%, 100% { opacity: 0.3; transform: scale(0.85); }
  50% { opacity: 1; transform: scale(1.15); }
}

/* ── 过渡动画 ── */
.fade-enter-active, .fade-leave-active { transition: opacity 0.25s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

.slide-up-enter-active { transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1); }
.slide-up-leave-active { transition: all 0.2s ease; }
.slide-up-enter-from { opacity: 0; transform: translateY(16px); }
.slide-up-leave-to { opacity: 0; }

/* ── 响应式 ── */
@media (max-width: 640px) {
  .stage { padding: 2.5rem 1rem 4rem; }
  .masthead h1 { font-size: 1.4rem; }
  textarea { min-height: 120px; font-size: 0.9rem; }
  .output-body { padding: 1rem; }
}
</style>
