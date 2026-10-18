# Reference lock

The user requested the installed VoiceOS 0.1.38 interface and local operation, without a subscription. Reference: C:/Program Files/VoiceOS/resources/app.asar. The original binary is unmodified.

## Observed product

The client contains Dashboard, Insights, History, Dictation, Agent, Apps and settings. Dictation supports None / Light / Polished, writing styles, dictionary, snippets, language selection, microphones and system shortcuts. Agent supports voice, memories, system actions, screen context and custom MCP integrations. Original tutorial subtitles and renderer code were inspected locally; no account/session data was read.

## Design decisions before implementation

|Decision|Evidence|Commitment|
|---|---|---|
|Sidebar|HomeKit, SidebarNavItem|220 px, 44 px navigation rows, 12 px corner radius, neutral active surface|
|Palette|HomeKit / DashboardButton|Neutral white/light gray or #171717/dark gray, blue reserved for activity and focus|
|Typography|HomeContent and bundled styles|System sans, 27 px semibold greeting, 14 px navigation, compact secondary text|
|Content|Original navigation and tutorial subtitles|Dashboard, Insights, History, Dictation, Agent, Apps; top agent and bottom dictation overlays|
|Interaction|Original dictation/agent tutorials|Global recording, local history, review actions before executing|
|Offline behavior|User instruction|Whisper.cpp for audio; llama.cpp + Qwen3.5 for text/vision; no VoiceOS authentication or telemetry|

The interface is independently implemented against these observed patterns. It does not contain the original renderer bundle. Exact visual parity and proprietary cloud integrations cannot be claimed.
