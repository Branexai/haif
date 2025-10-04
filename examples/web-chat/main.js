const $ = (id) => document.getElementById(id)

const state = {
  messages: []
}

function render() {
  const list = $("messages")
  list.innerHTML = ""
  for (const m of state.messages) {
    const div = document.createElement("div")
    div.className = `msg ${m.role}`
    div.innerHTML = `
      <div class="avatar">${m.role === "user" ? "U" : "S"}</div>
      <div class="bubble">${m.text}</div>
    `
    list.appendChild(div)
  }
  list.scrollTop = list.scrollHeight
}

function setStatus(kind, text) {
  const header = $("status")
  header.textContent = text
  header.className = `status status-${kind}`

  const inline = $("inlineStatus")
  inline.textContent = text
  inline.className = `inline-status inline-${kind}`
}

function getGatewayUrl() {
  const v = $("gatewayUrl").value.trim() || "http://localhost:3000"
  return v.endsWith("/") ? v.slice(0, -1) : v
}

async function sendMessage() {
  const input = $("input").value.trim()
  if (!input) return
  $("input").value = ""

  const model = $("modelName").value.trim()
  const gateway = getGatewayUrl()
  const endpoint = `${gateway}/infer`

  state.messages.push({ role: "user", text: input })
  render()

  const body = model ? { model, prompt: input } : { input }
  const headers = { "content-type": "application/json" }

  setStatus("posting", "Posting…")
  try {
    const res = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(body) })
    const data = await res.json()
    const pretty = JSON.stringify(data, null, 2)
    state.messages.push({ role: "system", text: pretty })
    render()
    setStatus("ok", "Connected")
  } catch (err) {
    const msg = (err && err.message) ? err.message : String(err)
    state.messages.push({ role: "system", text: `Error: ${msg}` })
    render()
    setStatus("error", `Network error: ${msg}`)
  }
}

function init() {
  $("gatewayUrl").value = localStorage.getItem("gatewayUrl") || "http://localhost:3000"
  $("modelName").value = localStorage.getItem("modelName") || ""
  setStatus("ready", "Ready")

  $("gatewayUrl").addEventListener("change", (e) => localStorage.setItem("gatewayUrl", e.target.value))
  $("modelName").addEventListener("change", (e) => localStorage.setItem("modelName", e.target.value))
  $("sendBtn").addEventListener("click", sendMessage)
  $("input").addEventListener("keydown", (e) => {
    // Send on plain Enter; allow Shift+Enter to insert a newline
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
      return
    }
    // Also support Ctrl/Cmd+Enter
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      sendMessage()
    }
  })
}

init()