# Movoa: AI Video Generator with Sound for VS Code

Unlimited AI video generator with sound: on paid plans the tenth take of a shot costs what the first did, and your first clip is free to make right now. This is the official [Movoa](https://movoa.ai/?utm_source=vscode&utm_medium=extension) extension for VS Code, Cursor and Windsurf.

Write a prompt in the command palette and the finished clip, with sound, is saved into your workspace: the same [text to video](https://movoa.ai/video/text-to-video) as on the site. Right-click a PNG, JPEG or WebP in the explorer to make it the first frame of a clip ([photo to video](https://movoa.ai/video/photo-to-video)). MiniMax H3 is the default model; [Seedance 2.5](https://movoa.ai/video/seedance-2-5), Seedance 2.0 (Fast and Mini too) and [Veo 3](https://movoa.ai/video/google-veo-3).1 Fast are a setting away.

| Command | What it does |
|---|---|
| **Movoa: Generate Video** | Prompt, then aspect ratio; the clip is saved to `assets/` (configurable). With a Markdown file open, a `<video>` tag is inserted |
| **Movoa: Animate Image into a Video** | Right-click an image (or pick one), describe the motion; the clip is saved next to the image |
| **Movoa: Show Credits** | Remaining credits on your account (free to call) |
| **Movoa: Set API Key** | Stores your key in VS Code's secret storage |

## Setup

1. Sign in on [movoa.ai](https://movoa.ai/?utm_source=vscode&utm_medium=extension) and create a key at [movoa.ai/settings/apikeys](https://movoa.ai/settings/apikeys).
2. Run **Movoa: Set API Key** and paste it. (`MOVOA_API_KEY` in the environment works too.)

Runs cost credits on your Movoa account, at the prices on [movoa.ai/pricing](https://movoa.ai/pricing).

## Settings

- `movoa.model`: `minimax-h3` (default), `seedance-2-5`, `seedance-2`, `seedance-2-fast`, `seedance-2-mini`, `veo-3-1-fast`
- `movoa.duration`: clip length in seconds (default 6). A length the model does not take is snapped to the nearest one it does
- `movoa.resolution`: `480p` (default), `720p` (Seedance, Veo) or `768p` (MiniMax H3)
- `movoa.outputFolder`: where new clips go (default `assets`)

Every clip comes with an [AI-generated soundtrack](https://movoa.ai/video/ai-video-with-audio). A clip takes a few minutes; the progress notification has a Cancel button, and a cancelled run still lands in your Movoa library.

MIT licensed. Source: [github.com/hanshs474/movoa-vscode](https://github.com/hanshs474/movoa-vscode). Also from Movoa: the [MCP server](https://www.npmjs.com/package/movoa-mcp) and [SDKs](https://movoa.readthedocs.io/en/latest/).
